import { AbstractNode } from "./AbstractNode";
import { Binding } from "./Binding";
import { Connection } from "./Connection";
import { INode, IOptions } from "./INode";
import { Message } from "./Message";
export declare let log: (type: string, message: string) => void;
export declare class Exchange extends AbstractNode {
    _type: string;
    constructor(connection: Connection, name: string, type?: string, options?: IExchangeOptions);
    /**
     * Initialize Exchange.
     */
    _initialize(): void;
    /**
     * Send message to this exchange.
     * @param message    - Message to be sent to exchange
     * @param routingKey - Message routing key
     */
    send(message: Message, routingKey?: string): void;
    /**
     * Send an rpc with the given request parameters.
     * @param requestParameters - Request parameters
     * @param routingKey        - Message routing key
     * @returns Promise that fulfills once a response has been received.
     */
    rpc(requestParameters: any, routingKey?: string): Promise<Message>;
    /**
     * Delete this exchange.
     */
    delete(): Promise<void>;
    /**
     * Close this exchange.
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
     * Create the reply queue to handle rpc resposne messages.
     * @param channel - AMQPlib Channel instance.
     */
    private createReplyQueue;
    /**
     * Create exchange.
     * @param channel - AMQPlib Channel instance.
     */
    private createExchange;
    /**
     * Invalidate this exchange & remove from connection
     */
    private invalidateExchange;
    /**
     * Disattach channel & connection from this exchange
     */
    private removeConnection;
}
export interface IExchangeOptions extends IOptions {
    internal?: boolean;
    alternateExchange?: string;
}
export interface IInitializeResult {
    exchange: string;
}
