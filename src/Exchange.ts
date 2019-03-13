import AMQPLib, { Replies } from "amqplib";
import * as Bluebird from "bluebird";
import { EventEmitter } from "events";
import uuid from "uuid";
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
  amqpLog.log(type, message, { module: "Exchange" });
};

// name for the RabbitMQ direct reply-to queue
const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";

export class Exchange extends AbstractNode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  public _type: string;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, type?: string, options: IExchangeOptions = {}) {
    super(connection, name, options);
    this._type = type;
    this._connection._exchanges[this._name] = this;
    this._initialize();
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

  /**
   * Initialize Exchange.
   */
  public _initialize() {
    this.initialized = this._connection.initialized
      .then(() => this._connection._connection.createChannel())
      .then((channel) => this.createReplyQueue(channel))
      .then((channel) => this.createExchange(channel));
  }

  /**
   * Send message to this exchange.
   * @param message    - Message to be sent to exchange
   * @param routingKey - Message routing key
   */
  public send(message: Message, routingKey = ""): void {
    message.sendTo(this, routingKey);
  }

  /**
   * Send an rpc with the given request parameters.
   * @param requestParameters - Request parameters
   * @param routingKey        - Message routing key
   * @returns Promise that fulfills once a response has been received.
   */
  public rpc(requestParameters: any, routingKey: string = ""): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      /**
       * RPC handler function.
       * @param resultMsg - AMQPlib Message instance
       */
      const rpcHandler = (resultMsg: AMQPLib.Message) => {
        const result = new Message(resultMsg.content, resultMsg.properties, resultMsg.fields);
        resolve(result);
      };

      /**
       * Attach event listener for response to correlationId attached to this rpc call.
       */
      const rpcSend = () => {
        const correlationId = uuid.v4();
        this._channel.once(correlationId, rpcHandler);
        const message = new Message(requestParameters, { correlationId, replyTo: DIRECT_REPLY_TO_QUEUE });
        message.sendTo(this, routingKey);
      };

      // execute sync when possible
      this.initialized.then(rpcSend);
    });
  }

  /**
   * Delete this exchange.
   */
  public delete(): Promise<void> {
    if (this._deleting === undefined) {
      this._deleting = this.initialized
        .then(() => Binding.removeBindingsContaining(this))
        .then(() => this._channel.deleteExchange(this._name, {}))
        .then(() => this._channel.close())
        .then(() => this.removeConnection());
    }
    return this._deleting;
  }

  /**
   * Close this exchange.
   */
  public close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = this.initialized
        .then(() => Binding.removeBindingsContaining(this))
        .then(() => this.invalidateExchange())
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
   * Create the reply queue to handle rpc resposne messages.
   * @param channel - AMQPlib Channel instance.
   */
  private createReplyQueue(channel: AMQPLib.Channel): AMQPLib.Channel {
    channel.setMaxListeners(0);
    channel.consume(DIRECT_REPLY_TO_QUEUE, (msg) => channel.emit(msg.properties.correlationId, msg), { noAck: true });
    return channel;
  }

  /**
   * Create exchange.
   * @param channel - AMQPlib Channel instance.
   */
  private createExchange(channel: AMQPLib.Channel): Promise<IInitializeResult> {
    this._channel = channel;

    const initializeExchange: Bluebird<Replies.Empty> = this._options.noCreate
      ? channel.checkExchange(this._name)
      : channel.assertExchange(this._name, this._type, this._options as AMQPLib.Options.AssertExchange);

    return new Promise((resolve, reject) => {
      initializeExchange
        .then((ok) => resolve(ok as IInitializeResult))
        .catch((err) => {
          log("error", `Failed to create exchange '${this._name}'.`);
          delete this._connection._exchanges[this._name];
          reject(err);
        });
    });
  }

  /**
   * Invalidate this exchange & remove from connection
   */
  private invalidateExchange() {
    delete this.initialized; // invalidate exchange
    delete this._connection._exchanges[this._name]; // remove the exchange from our administration
  }

  /**
   * Disattach channel & connection from this exchange
   */
  private removeConnection() {
    delete this._channel;
    delete this._connection;
  }
}

// =============================================================================
//  Interface/Types
// =============================================================================
export interface IExchangeOptions extends IOptions {
  internal?: boolean;
  alternateExchange?: string;
}

export interface IInitializeResult {
  exchange: string;
}
