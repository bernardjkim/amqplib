import {
  Channel as _Channel,
  ConsumeMessage as _ConsumeMessage,
  Message as _Message,
  Options as _Options,
  Replies as _Replies
} from "amqplib";
import * as Bluebird from "bluebird";
import * as winston from "winston";

import { AbstractNode } from "./AbstractNode";
import { Binding } from "./Binding";
import { Connection } from "./Connection";
import { Message } from "./Message";
import { Node, Options } from "./Node";

// create a custom winston logger for amqp-ts
const amqpLog = winston.createLogger({
  transports: [new winston.transports.Console()]
});

const log = (type: string, message: string) => {
  amqpLog.log(type, message, { module: "Queue" });
};

export class Queue extends AbstractNode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  _consumer!: Consumer;
  _consumerOptions!: _Options.Consume;
  _consumerTag!: string;
  _consumerInitialized!: Promise<ConsumerResult>;
  _consumerStopping!: boolean;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, options: QueueOptions = {}) {
    super(connection, name, options as QueueOptions);
    this._connection._queues[this._name] = this;
    this._initialize();
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

  /**
   * Initialize queue.
   */
  _initialize(): void {
    this.initialized = this._connection.initialized
      .then(() => this._connection._connection.createChannel())
      .then((channel) => this.createQueue(channel));
  }

  /**
   * Set the prefetch count for this channel.
   * @param count - Number of messages to prefetch
   */
  prefetch(count: number): void {
    this.initialized.then(() => {
      this._channel.prefetch(count);
      (this._options as QueueOptions).prefetch = count;
    });
  }

  /**
   * Requeue unacknowledged messages on this channel.
   * @returns Promise that fulfills once all messages have been requeued.
   */
  async recover(): Promise<_Replies.Empty> {
    return this.initialized.then(() => this._channel.recover());
  }

  /**
   * Activate consumer.
   * @param onMessage - Consumer function
   * @param options   - Consumer options
   */
  activateConsumer(onMessage: Consumer, options: _Options.Consume = {}): Promise<ConsumerResult> {
    if (!this._consumerInitialized) {
      this._consumerOptions = options;
      this._consumer = onMessage;
      this._initializeConsumer();
    }
    return this._consumerInitialized;
  }

  /**
   * Initialize consumer
   */
  _initializeConsumer(): void {
    this._consumerInitialized = this.initialized
      .then(() => {
        return this._channel.consume(this._name, this.wrapConsumer, this._consumerOptions);
      })
      .then((ok) => {
        this._consumerTag = ok.consumerTag;
        return ok;
      });
  }

  /**
   * Stop consumer.
   */
  async stopConsumer(): Promise<void> {
    if (!this._consumerInitialized || this._consumerStopping) {
      return Promise.resolve();
    }

    return this._consumerInitialized
      .then(() => this._channel.cancel(this._consumerTag))
      .then(() => (this._consumerStopping = true))
      .then(() => this.invalidateConsumer());
  }

  /**
   * Delete this queue.
   */
  delete(): Promise<DeleteResult> {
    if (this._deleting === undefined) {
      this._closing = this.initialized
        .then(() => Binding.removeBindingsContaining(this))
        .then(() => this._channel.deleteQueue(this._name, {}))
        .then(() => this.stopConsumer())
        .then(() => this.invalidateQueue())
        .then(() => this._channel.close())
        .then(() => this.removeConnection());
    }
    return this._deleting;
  }

  /**
   * Close this queue.
   */
  close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = this.initialized
        .then(() => Binding.removeBindingsContaining(this))
        .then(() => this.stopConsumer())
        .then(() => this.invalidateQueue())
        .then(() => this._channel.close())
        .then(() => this.removeConnection());
    }
    return this._closing;
  }
  /**
   * Bind this to the source for messages with the specified pattern.
   * @param source  - Source exchange
   * @param pattern - Routing pattern
   * @param args    - Args
   * @returns Promise that fulfills once the binding has been initialized.
   */
  bind(source: Node, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }

  /**
   * Unbind this from the source
   * @param source  - Source exchange
   * @param pattern - Routing pattern
   * @param args    - Args
   * @returns Promise that fulfills once the binding has been deleted.
   */
  unbind(source: Node, pattern = "", args: any = {}): Promise<void> {
    return this._connection._bindings[Binding.id(this, source, pattern)].delete();
  }

  // ===========================================================================
  //  Private
  // ===========================================================================

  /**
   * Initialize queue.
   * @param channel - AMQPlib Channel instance.
   * @returns Promise that fulfills once the queue has been initialized
   */
  private createQueue(channel: _Channel): Promise<InitializeQueueResult> {
    this._channel = channel;

    const initializeQueue: Bluebird<_Replies.AssertQueue> = this._options.noCreate
      ? channel.checkQueue(this._name)
      : channel.assertQueue(this._name);

    return new Promise((resolve, reject) => {
      initializeQueue
        .then((ok) => {
          if ((this._options as QueueOptions).prefetch) {
            channel.prefetch((this._options as QueueOptions).prefetch || 0);
          }
          resolve(ok as InitializeQueueResult);
        })
        .catch((err) => {
          log("error", `Failed to create queue '${this._name}'.`);
          delete this._connection._queues[this._name];
          reject(err);
        });
    });
  }

  /**
   * Activate consumer wrapper.
   * @param msg - AMQPlib message
   */
  private wrapConsumer = async (msg: _ConsumeMessage | null) => {
    if (!msg) return;
    // init Message
    const message = new Message(msg.content, msg.properties, msg.fields);
    message._message = msg;
    message._channel = this._channel;

    // process message
    let result = this._consumer(message);

    // wait for promise to resolve
    if (result instanceof Promise) {
      result
        .then((value) => (result = value))
        .catch((err) => log("error", `Queue.onMessage RPC promise returned error: ${err.message}`));
    }

    // check if there is a reply-to
    if (msg.properties.replyTo) {
      const { replyTo, correlationId } = msg.properties;
      this.replyToQueue(await result, replyTo, correlationId);
    }
  };

  /**
   * Send the response to the specified replyTo queue.
   * @param response      - Response msg
   * @param replyTo       - ReplyTo queue
   * @param correlationId - Request message correlationId
   */
  private replyToQueue(response: any, replyTo: string, correlationId: string): void {
    if (!(response instanceof Message)) {
      response = new Message(response);
    }
    const options = { ...response.properties, correlationId };
    this._channel.sendToQueue(replyTo, response.content, options);
  }

  /**
   * Invalidate this exchange & remove from connection
   */
  private invalidateQueue() {
    delete this.initialized; // invalidate exchange
    delete this._connection._queues[this._name]; // remove the queue from our administration
  }

  /**
   * Disattach channel & connection from this exchange
   */
  private removeConnection() {
    delete this._channel;
    delete this._connection;
  }

  private invalidateConsumer() {
    delete this._consumerInitialized;
    delete this._consumer;
    delete this._consumerOptions;
    delete this._consumerStopping;
  }
}

// =============================================================================
//  Interface/Types
// =============================================================================
export interface QueueOptions extends Options {
  exclusive?: boolean;
  messageTtl?: number;
  expires?: number;
  deadLetterExchange?: string;
  maxLength?: number;
  prefetch?: number;
}
export type Consumer = (msg: Message, channel?: _Channel) => any;

export interface ConsumerResult {
  consumerTag: string;
}
export interface InitializeQueueResult {
  queue: string;
  messageCount: number;
  consumerCount: number;
}
export interface DeleteResult {
  messageCount: number;
}
