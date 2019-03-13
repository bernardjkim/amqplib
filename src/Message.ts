import AMQPLib from "amqplib";
import winston from "winston";

import { INode } from "./INode";
// import { Exchange } from "./Exchange";
import { Queue } from "./Queue";

// create a custom winston logger for amqp-ts
const amqpLog = winston.createLogger({
  transports: [new winston.transports.Console()]
});

const log = (type: string, message: string) => {
  amqpLog.log(type, message, { module: "Message" });
};

export class Message {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  public content: Buffer;
  public fields: any;
  public properties: any;

  public _channel: AMQPLib.Channel; // for received messages only: the channel it has been received on
  public _message: AMQPLib.Message; // received messages only: original amqplib message

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(content?: any, properties: any = {}, fields: any = {}) {
    this.properties = properties;
    this.fields = fields;
    if (content !== undefined) {
      this.setContent(content);
    }
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

  /**
   * Set the content of the message.
   * @param content - Message content
   */
  public setContent(content: any): void {
    if (typeof content === "string") {
      this.content = Buffer.from(content);
    } else if (!(content instanceof Buffer)) {
      this.content = Buffer.from(JSON.stringify(content));
      this.properties.contentType = "application/json";
    } else {
      this.content = content;
    }
  }

  /**
   * Get the content of the message.
   * @returns The content of the message.
   */
  public getContent(): any {
    let content = this.content.toString();
    if (this.properties.contentType === "application/json") {
      content = JSON.parse(content);
    }
    return content;
  }

  /**
   * Send this message to the specified destination with the given routingKey when possible.
   * @param destination - Where the message will be sent
   * @param routingKey  - The message routing key
   */
  public sendTo(destination: INode, routingKey: string = ""): void {
    // inline function to send the message
    const sendMessage = () => {
      try {
        destination._channel.publish(exchange, routingKey, this.content, this.properties);
      } catch (err) {
        log("debug", "Publish error: " + err.message);
        log("debug", "Try to rebuild connection, before Call.");
        const connection = destination._connection;
        connection
          ._rebuildAll(err)
          .then(() => log("debug", "Retransmitting message."))
          .then(() => connection.initialized)
          .then(() => this.sendTo(destination, routingKey))
          .catch((err) => log("error", err.message));
      }
    };

    let exchange: string;
    if (destination instanceof Queue) {
      exchange = "";
      routingKey = destination._name;
    } else {
      exchange = destination._name;
    }

    // execute sync when possible
    (destination.initialized as Promise<any>).then(sendMessage);
  }

  /**
   * Acknowledge message.
   * @param allUpTo - If true, all outstanding messages prior to and including
   *                  the given message shall be considered acknowledged.
   *                  Defaults to **false**
   */
  public ack(allUpTo?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.ack(this._message, allUpTo);
    }
  }

  /**
   * Reject message. Requeue or throw away the message.
   * @param allUpTo - If true, all outstanding messages prior to and including
   *                  this message are rejected. Defaults to **false**
   * @param requeue - is true, the server will try to put the message back on
   *                  the queue or queues from which they came. Defaults to
   *                  **true**
   */
  public nack(allUpTo?: boolean, requeue?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.nack(this._message, allUpTo, requeue);
    }
  }
}
