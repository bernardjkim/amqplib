import { connect, Connection as _Connection } from "amqplib";
import * as winston from "winston";
import { Binding } from "./Binding";
import { Exchange, ExchangeOptions } from "./Exchange";
import { Queue, QueueOptions } from "./Queue";

// create a custom winston logger for amqp-ts
const amqpLog = winston.createLogger({
  transports: [new winston.transports.Console()]
});

const log = (type: string, message: string) => {
  amqpLog.log(type, message, { module: "Connection" });
};

export class Connection {
  // ===========================================================================
  //  Fields
  // ===========================================================================

  initialized!: Promise<void>;

  _connection!: _Connection;
  _rebuilding = false;
  _isClosing = false;

  _exchanges: { [id: string]: Exchange };
  _queues: { [id: string]: Queue };
  _bindings: { [id: string]: Binding };

  private url: string;
  private socketOptions: any;
  private reconnectStrategy: ReconnectStrategy;

  // ===========================================================================
  //  Constructor
  // ===========================================================================

  constructor(
    url = "amqp://localhost:5672",
    socketOptions: any = {},
    reconnectStrategy: ReconnectStrategy = { retries: 0, interval: 1500 }
  ) {
    this.url = url;
    this.socketOptions = socketOptions;
    this.reconnectStrategy = reconnectStrategy;
    this._exchanges = {};
    this._queues = {};
    this._bindings = {};

    this.rebuildConnection();
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

  /**
   * Create an exchange with the specified fields & options.
   * @param name    - Exchange name
   * @param type    - Exchange type
   * @param options - Exchange options
   * @returns Declared Exchange
   */
  declareExchange(name: string, type?: string, options?: ExchangeOptions): Exchange {
    let exchange = this._exchanges[name];
    if (exchange === undefined) {
      exchange = new Exchange(this, name, type, options);
    }
    return exchange;
  }

  /**
   * Create a queue with the specified name & options.
   * @param name    - Queue name
   * @param options - Queue options
   * @returns Declared Queue
   */
  declareQueue(name: string, options?: QueueOptions): Queue {
    let queue = this._queues[name];
    if (queue === undefined) {
      queue = new Queue(this, name, options);
    }
    return queue;
  }

  /**
   * Create the given toplogy structure.
   * @param topology Connection topology
   * @returns Promise that fullfils after all Exchanges, Queues, & Bindings have been initialized.
   */
  declareTopology(topology: Topology): Promise<any> {
    const promises: Array<Promise<any>> = [];
    let i: number;
    let len: number;

    if (topology.exchanges !== undefined) {
      for (i = 0, len = topology.exchanges.length; i < len; i++) {
        const exchange = topology.exchanges[i];
        promises.push(this.declareExchange(exchange.name, exchange.type, exchange.options).initialized);
      }
    }
    if (topology.queues !== undefined) {
      for (i = 0, len = topology.queues.length; i < len; i++) {
        const queue = topology.queues[i];
        promises.push(this.declareQueue(queue.name, queue.options).initialized);
      }
    }
    if (topology.bindings !== undefined) {
      for (i = 0, len = topology.bindings.length; i < len; i++) {
        const binding = topology.bindings[i];
        const source = this.declareExchange(binding.source);
        let destination: Queue | Exchange;
        if (binding.exchange !== undefined) {
          destination = this.declareExchange(binding.exchange);
          promises.push(destination.bind(source, binding.pattern, binding.args));
        } else if (binding.queue !== undefined) {
          destination = this.declareQueue(binding.queue);
          promises.push(destination.bind(source, binding.pattern, binding.args));
        } else {
          throw new Error("Binding should have either exchange or queue defined");
        }
      }
    }
    return Promise.all(promises);
  }

  /**
   * Make sure the whole defined connection topology is configured:
   * @returns Promise that fulfills after all defined exchanges, queues and bindings are initialized
   */
  completeConfiguration(): Promise<any> {
    const promises: Array<Promise<any>> = [];
    for (const exchangeId of Object.keys(this._exchanges)) {
      const exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.initialized);
    }
    for (const queueId of Object.keys(this._queues)) {
      const queue: Queue = this._queues[queueId];
      promises.push(queue.initialized);
      if (queue._consumerInitialized) {
        promises.push(queue._consumerInitialized);
      }
    }
    for (const bindingId of Object.keys(this._bindings)) {
      const binding: Binding = this._bindings[bindingId];
      promises.push(binding.initialized);
    }
    return Promise.all(promises);
  }

  /**
   * Delete the whole defined connection topology:
   * @returns Promise that fulfills after all defined exchanges, queues and bindings have been removed
   */
  deleteConfiguration(): Promise<any> {
    const promises: Array<Promise<any>> = [];
    for (const bindingId of Object.keys(this._bindings)) {
      const binding: Binding = this._bindings[bindingId];
      promises.push(binding.delete());
    }
    for (const queueId of Object.keys(this._queues)) {
      const queue: Queue = this._queues[queueId];
      if (queue._consumerInitialized) {
        promises.push(queue.stopConsumer());
      }
      promises.push(queue.delete());
    }
    for (const exchangeId of Object.keys(this._exchanges)) {
      const exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.delete());
    }
    return Promise.all(promises);
  }

  /**
   * Close connection to message broker service.
   * @returns Promise that fulfills after connection is closed
   */
  async close(): Promise<void> {
    this._isClosing = true;
    return this.initialized.then(() => this._connection.close());
  }

  /**
   * Rebuild connection topology.
   * @param err - Error object
   * @returns Promise that fulfills after the topology has been rebuilt.
   */
  _rebuildAll(err: Error): Promise<void> {
    log("warn", "Connection error: " + err.message);

    log("debug", "Rebuilding connection NOW.");
    this.rebuildConnection();

    // re initialize exchanges, queues and bindings if they exist
    for (const exchangeId of Object.keys(this._exchanges)) {
      const exchange = this._exchanges[exchangeId];
      log("debug", "Re-initialize Exchange '" + exchange._name + "'.");
      exchange._initialize();
    }
    for (const queueId of Object.keys(this._queues)) {
      const queue = this._queues[queueId];
      const consumer = queue._consumer;
      log("debug", "Re-initialize queue '" + queue._name + "'.");
      queue._initialize();
      if (consumer) {
        log("debug", "Re-initialize consumer for queue '" + queue._name + "'.");
        queue._initializeConsumer();
      }
    }
    for (const bindingId of Object.keys(this._bindings)) {
      const binding = this._bindings[bindingId];
      log(
        "debug",
        "Re-initialize binding from '" + binding._source._name + "' to '" + binding._destination._name + "'."
      );
      binding._initialize();
    }

    return new Promise<void>((resolve, reject) => {
      this.completeConfiguration().then(
        () => {
          log("debug", "Rebuild success.");
          resolve();
        } /* istanbul ignore next */,
        (rejectReason) => {
          log("debug", "Rebuild failed.");
          reject(rejectReason);
        }
      );
    });
  }

  // ===========================================================================
  //  Private
  // ===========================================================================

  /**
   * Rebuild connection to mq service
   * @returns Promise that fulfills once the connection has been established.
   */
  private rebuildConnection(): Promise<void> {
    if (this._rebuilding) {
      return this.initialized;
    }
    this._rebuilding = true;
    this._isClosing = false;

    // rebuild the connection
    this.initialized = this.tryToConnect()
      .then(() => log("info", "Connection established"))
      .catch((_err) => log("warn", "Error creating connection!"))
      .finally(() => (this._rebuilding = false));

    return this.initialized;
  }

  /**
   * Attempt to connect to the mq service. Will retry on connection failure.
   * @param retry - Number of retry attempts
   * @returns Promise that fulfills once the connection has been initialized.
   */
  private tryToConnect(retry = 0): Promise<void> {
    return new Promise(async (resolve, reject) => {
      connect(
        this.url,
        this.socketOptions
      )
        .then((connection) => this.attachEventListeners(connection))
        .then((connection) => (this._connection = connection))
        .then(() => resolve())
        .catch(() => this.retryConnection(retry + 1))
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * Attach error & close event listeners the the provided connection instance.
   * @param connection - AMPQ Connection instance
   * @returns The provided connection after attaching the event listeners.
   */
  private attachEventListeners(connection: _Connection): _Connection {
    /**
     * Handler function that is triggered by connection error events.
     * @param err - Connection error
     */
    const restart = (err: Error) => {
      log("debug", "Connection error occured.");
      connection.removeListener("error", restart);
      this._rebuildAll(err); // try to rebuild the topology when the connection unexpectedly closes
    };

    /**
     * Handler function that is triggered by connection close events.
     */
    const onClose = () => {
      connection.removeListener("close", onClose);
      if (!this._isClosing) {
        restart(new Error("Connection closed by remote host"));
      }
    };
    // attach event listeners
    connection.on("error", restart);
    connection.on("close", onClose);
    return connection;
  }

  /**
   * Retry connection if retry attempts have not all been used up.
   * @param err - Error object
   * @returns Promise that fulfills once the connection has been initialized.
   */
  private retryConnection(retry: number): Promise<void> {
    const { retries, interval } = this.reconnectStrategy;

    // out of retry attempts
    if (retries !== 0 && retries < retry) {
      log("warn", `Connection failed, exiting: No connection retries left (retry ${retry})`);
      throw new Error("Connection failed");
    }

    // log & retry after set interval
    log("warn", `Connection failed, Connection retry ${retry} in ${interval}ms`);
    return new Promise((resolve, reject) => {
      const cb = () =>
        this.tryToConnect(retry)
          .then(() => resolve())
          .catch(reject);

      setTimeout(cb, interval);
    });
  }
}

// =============================================================================
//  Interface/Types
// =============================================================================

/**
 * A ReconnectStrategy defines the number of retey attempts allowed when unable
 * to connection to the message broker as well as the time interval between
 * each retry attempt.
 */
export interface ReconnectStrategy {
  retries: number; // number of retries, 0 is forever
  interval: number; // retry interval in ms
}

/**
 * A Topology defines the set of Exchanges, Queues, and Bindings that exist
 * in this Connection.
 */
export interface Topology {
  exchanges: Array<{ name: string; type?: string; options?: any }>;
  queues: Array<{ name: string; options?: any }>;
  bindings: Array<{ source: string; queue?: string; exchange?: string; pattern?: string; args?: any }>;
}
