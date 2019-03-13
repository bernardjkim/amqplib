"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const amqplib_1 = __importDefault(require("amqplib"));
const winston_1 = __importDefault(require("winston"));
const Exchange_1 = require("./Exchange");
const Queue_1 = require("./Queue");
// create a custom winston logger for amqp-ts
const amqpLog = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()]
});
exports.log = (type, message) => {
    amqpLog.log(type, message, { module: "Connection" });
};
class Connection {
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(url = "amqp://localhost:5672", socketOptions = {}, reconnectStrategy = { retries: 0, interval: 1500 }) {
        this._rebuilding = false;
        this._isClosing = false;
        this.url = url;
        this.socketOptions = socketOptions;
        this.reconnectStrategy = reconnectStrategy;
        this._exchanges = {};
        this._queues = {};
        this._bindings = {};
        this.rebuildConnection();
    }
    // ===========================================================================
    //  Public
    // ===========================================================================
    /**
     * Create an exchange with the specified fields & options.
     * @param name    - Exchange name
     * @param type    - Exchange type
     * @param options - Exchange options
     * @returns Declared Exchange
     */
    declareExchange(name, type, options) {
        let exchange = this._exchanges[name];
        if (exchange === undefined) {
            exchange = new Exchange_1.Exchange(this, name, type, options);
        }
        return exchange;
    }
    /**
     * Create a queue with the specified name & options.
     * @param name    - Queue name
     * @param options - Queue options
     * @returns Declared Queue
     */
    declareQueue(name, options) {
        let queue = this._queues[name];
        if (queue === undefined) {
            queue = new Queue_1.Queue(this, name, options);
        }
        return queue;
    }
    /**
     * Create the given toplogy structure.
     * @param topology Connection topology
     * @returns Promise that fullfils after all Exchanges, Queues, & Bindings have been initialized.
     */
    declareTopology(topology) {
        const promises = [];
        let i;
        let len;
        if (topology.exchanges !== undefined) {
            for (i = 0, len = topology.exchanges.length; i < len; i++) {
                const exchange = topology.exchanges[i];
                promises.push(this.declareExchange(exchange.name, exchange.type, exchange.options).initialized);
            }
        }
        if (topology.queues !== undefined) {
            for (i = 0, len = topology.queues.length; i < len; i++) {
                const queue = topology.queues[i];
                promises.push(this.declareQueue(queue.name, queue.options).initialized);
            }
        }
        if (topology.bindings !== undefined) {
            for (i = 0, len = topology.bindings.length; i < len; i++) {
                const binding = topology.bindings[i];
                const source = this.declareExchange(binding.source);
                let destination;
                if (binding.exchange !== undefined) {
                    destination = this.declareExchange(binding.exchange);
                }
                else {
                    destination = this.declareQueue(binding.queue);
                }
                promises.push(destination.bind(source, binding.pattern, binding.args));
            }
        }
        return Promise.all(promises);
    }
    /**
     * Make sure the whole defined connection topology is configured:
     * @returns Promise that fulfills after all defined exchanges, queues and bindings are initialized
     */
    completeConfiguration() {
        const promises = [];
        for (const exchangeId of Object.keys(this._exchanges)) {
            const exchange = this._exchanges[exchangeId];
            promises.push(exchange.initialized);
        }
        for (const queueId of Object.keys(this._queues)) {
            const queue = this._queues[queueId];
            promises.push(queue.initialized);
            if (queue._consumerInitialized) {
                promises.push(queue._consumerInitialized);
            }
        }
        for (const bindingId of Object.keys(this._bindings)) {
            const binding = this._bindings[bindingId];
            promises.push(binding.initialized);
        }
        return Promise.all(promises);
    }
    /**
     * Delete the whole defined connection topology:
     * @returns Promise that fulfills after all defined exchanges, queues and bindings have been removed
     */
    deleteConfiguration() {
        const promises = [];
        for (const bindingId of Object.keys(this._bindings)) {
            const binding = this._bindings[bindingId];
            promises.push(binding.delete());
        }
        for (const queueId of Object.keys(this._queues)) {
            const queue = this._queues[queueId];
            if (queue._consumerInitialized) {
                promises.push(queue.stopConsumer());
            }
            promises.push(queue.delete());
        }
        for (const exchangeId of Object.keys(this._exchanges)) {
            const exchange = this._exchanges[exchangeId];
            promises.push(exchange.delete());
        }
        return Promise.all(promises);
    }
    /**
     * Close connection to message broker service.
     * @returns Promise that fulfills after connection is closed
     */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this._isClosing = true;
            return this.initialized.then(() => this._connection.close());
        });
    }
    /**
     * Rebuild connection topology.
     * @param err - Error object
     * @returns Promise that fulfills after the topology has been rebuilt.
     */
    _rebuildAll(err) {
        exports.log("warn", "Connection error: " + err.message);
        exports.log("debug", "Rebuilding connection NOW.");
        this.rebuildConnection();
        // re initialize exchanges, queues and bindings if they exist
        for (const exchangeId of Object.keys(this._exchanges)) {
            const exchange = this._exchanges[exchangeId];
            exports.log("debug", "Re-initialize Exchange '" + exchange._name + "'.");
            exchange._initialize();
        }
        for (const queueId of Object.keys(this._queues)) {
            const queue = this._queues[queueId];
            const consumer = queue._consumer;
            exports.log("debug", "Re-initialize queue '" + queue._name + "'.");
            queue._initialize();
            if (consumer) {
                exports.log("debug", "Re-initialize consumer for queue '" + queue._name + "'.");
                queue._initializeConsumer();
            }
        }
        for (const bindingId of Object.keys(this._bindings)) {
            const binding = this._bindings[bindingId];
            exports.log("debug", "Re-initialize binding from '" + binding._source._name + "' to '" + binding._destination._name + "'.");
            binding._initialize();
        }
        return new Promise((resolve, reject) => {
            this.completeConfiguration().then(() => {
                exports.log("debug", "Rebuild success.");
                resolve(null);
            } /* istanbul ignore next */, (rejectReason) => {
                exports.log("debug", "Rebuild failed.");
                reject(rejectReason);
            });
        });
    }
    // ===========================================================================
    //  Private
    // ===========================================================================
    /**
     * Rebuild connection to mq service
     * @returns Promise that fulfills once the connection has been established.
     */
    rebuildConnection() {
        if (this._rebuilding) {
            return this.initialized;
        }
        this._rebuilding = true;
        this._isClosing = false;
        // rebuild the connection
        this.initialized = this.tryToConnect()
            .then(() => exports.log("info", "Connection established"))
            .catch((_err) => exports.log("warn", "Error creating connection!"))
            .finally(() => (this._rebuilding = false));
        return this.initialized;
    }
    /**
     * Attempt to connect to the mq service. Will retry on connection failure.
     * @param retry - Number of retry attempts
     * @returns Promise that fulfills once the connection has been initialized.
     */
    tryToConnect(retry = 0) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            amqplib_1.default.connect(this.url, this.socketOptions)
                .then((connection) => this.attachEventListeners(connection))
                .then((connection) => (this._connection = connection))
                .then(() => resolve())
                .catch(() => this.retryConnection(retry + 1))
                .then(() => resolve())
                .catch(reject);
        }));
    }
    /**
     * Attach error & close event listeners the the provided connection instance.
     * @param connection - AMPQ Connection instance
     * @returns The provided connection after attaching the event listeners.
     */
    attachEventListeners(connection) {
        /**
         * Handler function that is triggered by connection error events.
         * @param err - Connection error
         */
        const restart = (err) => {
            exports.log("debug", "Connection error occured.");
            connection.removeListener("error", restart);
            this._rebuildAll(err); // try to rebuild the topology when the connection unexpectedly closes
        };
        /**
         * Handler function that is triggered by connection close events.
         */
        const onClose = () => {
            connection.removeListener("close", onClose);
            if (!this._isClosing) {
                restart(new Error("Connection closed by remote host"));
            }
        };
        // attach event listeners
        connection.on("error", restart);
        connection.on("close", onClose);
        return connection;
    }
    /**
     * Retry connection if retry attempts have not all been used up.
     * @param err - Error object
     * @returns Promise that fulfills once the connection has been initialized.
     */
    retryConnection(retry) {
        const { retries, interval } = this.reconnectStrategy;
        // out of retry attempts
        if (retries !== 0 && retries < retry) {
            exports.log("warn", `Connection failed, exiting: No connection retries left (retry ${retry})`);
            throw new Error("Connection failed");
        }
        // log & retry after set interval
        exports.log("warn", `Connection failed, Connection retry ${retry} in ${interval}ms`);
        return new Promise((resolve, reject) => {
            const cb = () => this.tryToConnect(retry)
                .then(() => resolve())
                .catch(reject);
            setTimeout(cb, interval);
        });
    }
}
exports.Connection = Connection;
//# sourceMappingURL=Connection.js.map