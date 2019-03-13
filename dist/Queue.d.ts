import AMQPLib, { Replies } from "amqplib";
import { AbstractNode } from "./AbstractNode";
import { Binding } from "./Binding";
import { Connection } from "./Connection";
import { INode, IOptions } from "./INode";
import { Message } from "./Message";
export declare let log: (type: string, message: string) => void;
export declare class Queue extends AbstractNode {
    _consumer: Consumer;
    _consumerOptions: AMQPLib.Options.Consume;
    _consumerTag: string;
    _consumerInitialized: Promise<IConsumerResult>;
    _consumerStopping: boolean;
    constructor(connection: Connection, name: string, options?: IQueueOptions);
    /**
     * Initialize queue.
     */
    _initialize(): void;
    /**
     * Set the prefetch count for this channel.
     * @param count - Number of messages to prefetch
     */
    prefetch(count: number): void;
    /**
     * Requeue unacknowledged messages on this channel.
     * @returns Promise that fulfills once all messages have been requeued.
     */
    recover(): Promise<Replies.Empty>;
    /**
     * Activate consumer.
     * @param onMessage - Consumer function
     * @param options   - Consumer options
     */
    activateConsumer(onMessage: Consumer, options?: AMQPLib.Options.Consume): Promise<IConsumerResult>;
    /**
     * Initialize consumer
     */
    _initializeConsumer(): void;
    /**
     * Stop consumer.
     */
    stopConsumer(): Promise<void>;
    /**
     * Delete this queue.
     */
    delete(): Promise<IDeleteResult>;
    /**
     * Close this queue.
     */
    close(): Promise<void>;
    /**
     * Bind this to the source for messages with the specified pattern.
     * @param source  - Source exchange
     * @param pattern - Routing pattern
     * @param args    - Args
     * @returns Promise that fulfills once the binding has been initialized.
     */
    bind(source: INode, pattern?: string, args?: any): Promise<Binding>;
    /**
     * Unbind this from the source
     * @param source  - Source exchange
     * @param pattern - Routing pattern
     * @param args    - Args
     * @returns Promise that fulfills once the binding has been deleted.
     */
    unbind(source: INode, pattern?: string, args?: any): Promise<void>;
    /**
     * Initialize queue.
     * @param channel - AMQPlib Channel instance.
     * @returns Promise that fulfills once the queue has been initialized
     */
    private createQueue;
    /**
     * Activate consumer wrapper.
     * @param msg - AMQPlib message
     */
    private wrapConsumer;
    /**
     * Send the response to the specified replyTo queue.
     * @param response      - Response msg
     * @param replyTo       - ReplyTo queue
     * @param correlationId - Request message correlationId
     */
    private replyToQueue;
    /**
     * Invalidate this exchange & remove from connection
     */
    private invalidateQueue;
    /**
     * Disattach channel & connection from this exchange
     */
    private removeConnection;
    private invalidateConsumer;
}
export interface IQueueOptions extends IOptions {
    exclusive?: boolean;
    messageTtl?: number;
    expires?: number;
    deadLetterExchange?: string;
    maxLength?: number;
    prefetch?: number;
}
export declare type Consumer = (msg: Message, channel?: AMQPLib.Channel) => any;
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
