import AMQPLib from "amqplib";
import { Binding } from "./Binding";
import { Exchange, IExchangeOptions } from "./Exchange";
import { IQueueOptions, Queue } from "./Queue";
export declare let log: (type: string, message: string) => void;
export declare class Connection {
    initialized: Promise<void>;
    _connection: AMQPLib.Connection;
    _rebuilding: boolean;
    _isClosing: boolean;
    _exchanges: {
        [id: string]: Exchange;
    };
    _queues: {
        [id: string]: Queue;
    };
    _bindings: {
        [id: string]: Binding;
    };
    private url;
    private socketOptions;
    private reconnectStrategy;
    constructor(url?: string, socketOptions?: any, reconnectStrategy?: IReconnectStrategy);
    /**
     * Create an exchange with the specified fields & options.
     * @param name    - Exchange name
     * @param type    - Exchange type
     * @param options - Exchange options
     * @returns Declared Exchange
     */
    declareExchange(name: string, type?: string, options?: IExchangeOptions): Exchange;
    /**
     * Create a queue with the specified name & options.
     * @param name    - Queue name
     * @param options - Queue options
     * @returns Declared Queue
     */
    declareQueue(name: string, options?: IQueueOptions): Queue;
    /**
     * Create the given toplogy structure.
     * @param topology Connection topology
     * @returns Promise that fullfils after all Exchanges, Queues, & Bindings have been initialized.
     */
    declareTopology(topology: ITopology): Promise<any>;
    /**
     * Make sure the whole defined connection topology is configured:
     * @returns Promise that fulfills after all defined exchanges, queues and bindings are initialized
     */
    completeConfiguration(): Promise<any>;
    /**
     * Delete the whole defined connection topology:
     * @returns Promise that fulfills after all defined exchanges, queues and bindings have been removed
     */
    deleteConfiguration(): Promise<any>;
    /**
     * Close connection to message broker service.
     * @returns Promise that fulfills after connection is closed
     */
    close(): Promise<void>;
    /**
     * Rebuild connection topology.
     * @param err - Error object
     * @returns Promise that fulfills after the topology has been rebuilt.
     */
    _rebuildAll(err: Error): Promise<void>;
    /**
     * Rebuild connection to mq service
     * @returns Promise that fulfills once the connection has been established.
     */
    private rebuildConnection;
    /**
     * Attempt to connect to the mq service. Will retry on connection failure.
     * @param retry - Number of retry attempts
     * @returns Promise that fulfills once the connection has been initialized.
     */
    private tryToConnect;
    /**
     * Attach error & close event listeners the the provided connection instance.
     * @param connection - AMPQ Connection instance
     * @returns The provided connection after attaching the event listeners.
     */
    private attachEventListeners;
    /**
     * Retry connection if retry attempts have not all been used up.
     * @param err - Error object
     * @returns Promise that fulfills once the connection has been initialized.
     */
    private retryConnection;
}
/**
 * A ReconnectStrategy defines the number of retey attempts allowed when unable
 * to connection to the message broker as well as the time interval between
 * each retry attempt.
 */
export interface IReconnectStrategy {
    retries: number;
    interval: number;
}
/**
 * A Topology defines the set of Exchanges, Queues, and Bindings that exist
 * in this Connection.
 */
export interface ITopology {
    exchanges: Array<{
        name: string;
        type?: string;
        options?: any;
    }>;
    queues: Array<{
        name: string;
        options?: any;
    }>;
    bindings: Array<{
        source: string;
        queue?: string;
        exchange?: string;
        pattern?: string;
        args?: any;
    }>;
}
