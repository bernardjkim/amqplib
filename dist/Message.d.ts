/// <reference types="node" />
import AMQPLib from "amqplib";
import { INode } from "./INode";
export declare let log: (type: string, message: string) => void;
export declare class Message {
    content: Buffer;
    fields: any;
    properties: any;
    _channel: AMQPLib.Channel;
    _message: AMQPLib.Message;
    constructor(content?: any, properties?: any, fields?: any);
    /**
     * Set the content of the message.
     * @param content - Message content
     */
    setContent(content: any): void;
    /**
     * Get the content of the message.
     * @returns The content of the message.
     */
    getContent(): any;
    /**
     * Send this message to the specified destination with the given routingKey when possible.
     * @param destination - Where the message will be sent
     * @param routingKey  - The message routing key
     */
    sendTo(destination: INode, routingKey?: string): void;
    /**
     * Acknowledge message.
     * @param allUpTo - If true, all outstanding messages prior to and including
     *                  the given message shall be considered acknowledged.
     *                  Defaults to **false**
     */
    ack(allUpTo?: boolean): void;
    /**
     * Reject message. Requeue or throw away the message.
     * @param allUpTo - If true, all outstanding messages prior to and including
     *                  this message are rejected. Defaults to **false**
     * @param requeue - is true, the server will try to put the message back on
     *                  the queue or queues from which they came. Defaults to
     *                  **true**
     */
    nack(allUpTo?: boolean, requeue?: boolean): void;
}
