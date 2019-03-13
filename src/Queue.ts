import AMQPLib, { Replies } from "amqplib";
import * as Bluebird from "bluebird";
import winston from "winston";

import { AbstractNode } from "./AbstractNode";
import { Binding } from "./Binding";
import { Connection } from "./Connection";
import { INode, IOptions } from "./INode";
import { Message } from "./Message";

// create a custom winston logger for amqp-ts
const amqpLog = winston.createLogger({
  transports: [new winston.transports.Console()]
});

export let log = (type: string, message: string) => {
  amqpLog.log(type, message, { module: "Queue" });
};

export class Queue extends AbstractNode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  public _consumer: Consumer;
  public _consumerOptions: AMQPLib.Options.Consume;
  public _consumerTag: string;
  public _consumerInitialized: Promise<IConsumerResult>;
  public _consumerStopping: boolean;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, options: IQueueOptions = {}) {
    super(connection, name, options as IQueueOptions);
    this._connection._queues[this._name] = this;
    this._initialize();
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

  /**
   * Initialize queue.
   */
  public _initialize(): void {
    this.initialized = this._connection.initialized
      .then(() => this._connection._connection.createChannel())
      .then((channel) => this.createQueue(channel));
  }

  /**
   * Set the prefetch count for this channel.
   * @param count - Number of messages to prefetch
   */
  public prefetch(count: number): void {
    this.initialized.then(() => {
      this._channel.prefetch(count);
      (this._options as IQueueOptions).prefetch = count;
    });
  }

  /**
   * Requeue unacknowledged messages on this channel.
   * @returns Promise that fulfills once all messages have been requeued.
   */
  public async recover(): Promise<Replies.Empty> {
    return this.initialized.then(() => this._channel.recover());
  }

  /**
   * Activate consumer.
   * @param onMessage - Consumer function
   * @param options   - Consumer options
   */
  public activateConsumer(onMessage: Consumer, options: AMQPLib.Options.Consume = {}): Promise<IConsumerResult> {
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
  public _initializeConsumer(): void {
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
  public async stopConsumer(): Promise<void> {
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
  public delete(): Promise<IDeleteResult> {
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
  public close(): Promise<void> {
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
  public bind(source: INode, pattern = "", args: any = {}): Promise<Binding> {
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
  public unbind(source: INode, pattern = "", args: any = {}): Promise<void> {
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
  private createQueue(channel: AMQPLib.Channel): Promise<IInitializeQueueResult> {
    this._channel = channel;

    const initializeQueue: Bluebird<Replies.AssertQueue> = this._options.noCreate
      ? channel.checkQueue(this._name)
      : channel.assertQueue(this._name);

    return new Promise((resolve, reject) => {
      initializeQueue
        .then((ok) => {
          if ((this._options as IQueueOptions).prefetch) {
            channel.prefetch((this._options as IQueueOptions).prefetch);
          }
          resolve(ok as IInitializeQueueResult);
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
  private wrapConsumer = async (msg: AMQPLib.Message) => {
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
  }

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
export interface IQueueOptions extends IOptions {
  exclusive?: boolean;
  messageTtl?: number;
  expires?: number;
  deadLetterExchange?: string;
  maxLength?: number;
  prefetch?: number;
}
export type Consumer = (msg: Message, channel?: AMQPLib.Channel) => any;

export interface IConsumerResult {
  consumerTag: string;
}
export interface IInitializeQueueResult {
  queue: string;
  messageCount: number;
  consumerCount: number;
}
export interface IDeleteResult {
  messageCount: number;
}
