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
const winston_1 = __importDefault(require("winston"));
const AbstractNode_1 = require("./AbstractNode");
const Binding_1 = require("./Binding");
const Message_1 = require("./Message");
// create a custom winston logger for amqp-ts
const amqpLog = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()]
});
exports.log = (type, message) => {
    amqpLog.log(type, message, { module: "Queue" });
};
class Queue extends AbstractNode_1.AbstractNode {
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(connection, name, options = {}) {
        super(connection, name, options);
        /**
         * Activate consumer wrapper.
         * @param msg - AMQPlib message
         */
        this.wrapConsumer = (msg) => __awaiter(this, void 0, void 0, function* () {
            // init Message
            const message = new Message_1.Message(msg.content, msg.properties, msg.fields);
            message._message = msg;
            message._channel = this._channel;
            // process message
            let result = this._consumer(message);
            // wait for promise to resolve
            if (result instanceof Promise) {
                result
                    .then((value) => (result = value))
                    .catch((err) => exports.log("error", `Queue.onMessage RPC promise returned error: ${err.message}`));
            }
            // check if there is a reply-to
            if (msg.properties.replyTo) {
                const { replyTo, correlationId } = msg.properties;
                this.replyToQueue(yield result, replyTo, correlationId);
            }
        });
        this._connection._queues[this._name] = this;
        this._initialize();
    }
    // ===========================================================================
    //  Public
    // ===========================================================================
    /**
     * Initialize queue.
     */
    _initialize() {
        this.initialized = this._connection.initialized
            .then(() => this._connection._connection.createChannel())
            .then((channel) => this.createQueue(channel));
    }
    /**
     * Set the prefetch count for this channel.
     * @param count - Number of messages to prefetch
     */
    prefetch(count) {
        this.initialized.then(() => {
            this._channel.prefetch(count);
            this._options.prefetch = count;
        });
    }
    /**
     * Requeue unacknowledged messages on this channel.
     * @returns Promise that fulfills once all messages have been requeued.
     */
    recover() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.initialized.then(() => this._channel.recover());
        });
    }
    /**
     * Activate consumer.
     * @param onMessage - Consumer function
     * @param options   - Consumer options
     */
    activateConsumer(onMessage, options = {}) {
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
    _initializeConsumer() {
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
    stopConsumer() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._consumerInitialized || this._consumerStopping) {
                return Promise.resolve();
            }
            return this._consumerInitialized
                .then(() => this._channel.cancel(this._consumerTag))
                .then(() => (this._consumerStopping = true))
                .then(() => this.invalidateConsumer());
        });
    }
    /**
     * Delete this queue.
     */
    delete() {
        if (this._deleting === undefined) {
            this._closing = this.initialized
                .then(() => Binding_1.Binding.removeBindingsContaining(this))
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
    close() {
        if (this._closing === undefined) {
            this._closing = this.initialized
                .then(() => Binding_1.Binding.removeBindingsContaining(this))
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
    bind(source, pattern = "", args = {}) {
        const binding = new Binding_1.Binding(this, source, pattern, args);
        return binding.initialized;
    }
    /**
     * Unbind this from the source
     * @param source  - Source exchange
     * @param pattern - Routing pattern
     * @param args    - Args
     * @returns Promise that fulfills once the binding has been deleted.
     */
    unbind(source, pattern = "", args = {}) {
        return this._connection._bindings[Binding_1.Binding.id(this, source, pattern)].delete();
    }
    // ===========================================================================
    //  Private
    // ===========================================================================
    /**
     * Initialize queue.
     * @param channel - AMQPlib Channel instance.
     * @returns Promise that fulfills once the queue has been initialized
     */
    createQueue(channel) {
        this._channel = channel;
        const initializeQueue = this._options.noCreate
            ? channel.checkQueue(this._name)
            : channel.assertQueue(this._name);
        return new Promise((resolve, reject) => {
            initializeQueue
                .then((ok) => {
                if (this._options.prefetch) {
                    channel.prefetch(this._options.prefetch);
                }
                resolve(ok);
            })
                .catch((err) => {
                exports.log("error", `Failed to create queue '${this._name}'.`);
                delete this._connection._queues[this._name];
                reject(err);
            });
        });
    }
    /**
     * Send the response to the specified replyTo queue.
     * @param response      - Response msg
     * @param replyTo       - ReplyTo queue
     * @param correlationId - Request message correlationId
     */
    replyToQueue(response, replyTo, correlationId) {
        if (!(response instanceof Message_1.Message)) {
            response = new Message_1.Message(response);
        }
        const options = Object.assign({}, response.properties, { correlationId });
        this._channel.sendToQueue(replyTo, response.content, options);
    }
    /**
     * Invalidate this exchange & remove from connection
     */
    invalidateQueue() {
        delete this.initialized; // invalidate exchange
        delete this._connection._queues[this._name]; // remove the queue from our administration
    }
    /**
     * Disattach channel & connection from this exchange
     */
    removeConnection() {
        delete this._channel;
        delete this._connection;
    }
    invalidateConsumer() {
        delete this._consumerInitialized;
        delete this._consumer;
        delete this._consumerOptions;
        delete this._consumerStopping;
    }
}
exports.Queue = Queue;
//# sourceMappingURL=Queue.js.map