import { Channel as _Channel, Message as _Message, Options as _Options, Replies as _Replies } from "amqplib";
import * as Bluebird from "bluebird";
import * as uuid from "uuid";
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
  amqpLog.log(type, message, { module: "Exchange" });
};

// name for the RabbitMQ direct reply-to queue
const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";

export class Exchange extends AbstractNode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  _type?: string;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, type?: string, options: ExchangeOptions = {}) {
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
  _initialize() {
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
  send(message: Message, routingKey = ""): void {
    message.sendTo(this, routingKey);
  }

  /**
   * Send an rpc with the given request parameters.
   * @param requestParameters - Request parameters
   * @param routingKey        - Message routing key
   * @returns Promise that fulfills once a response has been received.
   */
  rpc(requestParameters: object, routingKey = ""): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      /**
       * RPC handler function.
       * @param resultMsg - AMQPlib Message instance
       */
      const rpcHandler = (resultMsg: _Message) => {
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
  delete(): Promise<void> {
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
  close(): Promise<void> {
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
  bind(source: Node, pattern = "", args: object = {}): Promise<Binding> {
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
  unbind(source: Node, pattern = "", args: object = {}): Promise<void> {
    return this._connection._bindings[Binding.id(this, source, pattern)].delete();
  }

  // ===========================================================================
  //  Private
  // ===========================================================================

  /**
   * Create the reply queue to handle rpc resposne messages.
   * @param channel - AMQPlib Channel instance.
   */
  private createReplyQueue(channel: _Channel): _Channel {
    channel.setMaxListeners(0);
    channel.consume(DIRECT_REPLY_TO_QUEUE, (msg) => channel.emit(msg ? msg.properties.correlationId : null, msg), {
      noAck: true
    });
    return channel;
  }

  /**
   * Create exchange.
   * @param channel - AMQPlib Channel instance.
   */
  private createExchange(channel: _Channel): Promise<InitializeResult> {
    this._channel = channel;

    const initializeExchange: Bluebird<_Replies.Empty> = this._options.noCreate
      ? channel.checkExchange(this._name)
      : channel.assertExchange(this._name, this._type || "", this._options as _Options.AssertExchange);

    return new Promise((resolve, reject) => {
      initializeExchange
        .then((ok) => resolve(ok as InitializeResult))
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
export interface ExchangeOptions extends Options {
  internal?: boolean;
  alternateExchange?: string;
}

export interface InitializeResult {
  exchange: string;
}
