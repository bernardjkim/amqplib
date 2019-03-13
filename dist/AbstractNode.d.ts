import AMQPLib from "amqplib";
import { Connection } from "./Connection";
import { INode, IOptions } from "./INode";
export declare abstract class AbstractNode implements INode {
    initialized: Promise<any>;
    _connection: Connection;
    _channel: AMQPLib.Channel;
    _name: string;
    _options: IOptions;
    _deleting: Promise<any>;
    _closing: Promise<void>;
    constructor(connection: Connection, name: string, options?: IOptions);
    /**
     * Initialize node.
     */
    abstract _initialize(): void;
    /**
     * Delete this node.
     */
    abstract delete(): Promise<any>;
    /**
     * Close this queue.
     */
    abstract close(): Promise<void>;
}
