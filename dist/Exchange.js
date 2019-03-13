"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = __importDefault(require("uuid"));
const winston_1 = __importDefault(require("winston"));
const AbstractNode_1 = require("./AbstractNode");
const Binding_1 = require("./Binding");
const Message_1 = require("./Message");
// create a custom winston logger for amqp-ts
const amqpLog = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()]
});
exports.log = (type, message) => {
    amqpLog.log(type, message, { module: "Exchange" });
};
// name for the RabbitMQ direct reply-to queue
const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
class Exchange extends AbstractNode_1.AbstractNode {
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(connection, name, type, options = {}) {
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
    send(message, routingKey = "") {
        message.sendTo(this, routingKey);
    }
    /**
     * Send an rpc with the given request parameters.
     * @param requestParameters - Request parameters
     * @param routingKey        - Message routing key
     * @returns Promise that fulfills once a response has been received.
     */
    rpc(requestParameters, routingKey = "") {
        return new Promise((resolve, reject) => {
            /**
             * RPC handler function.
             * @param resultMsg - AMQPlib Message instance
             */
            const rpcHandler = (resultMsg) => {
                const result = new Message_1.Message(resultMsg.content, resultMsg.properties, resultMsg.fields);
                resolve(result);
            };
            /**
             * Attach event listener for response to correlationId attached to this rpc call.
             */
            const rpcSend = () => {
                const correlationId = uuid_1.default.v4();
                this._channel.once(correlationId, rpcHandler);
                const message = new Message_1.Message(requestParameters, { correlationId, replyTo: DIRECT_REPLY_TO_QUEUE });
                message.sendTo(this, routingKey);
            };
            // execute sync when possible
            this.initialized.then(rpcSend);
        });
    }
    /**
     * Delete this exchange.
     */
    delete() {
        if (this._deleting === undefined) {
            this._deleting = this.initialized
                .then(() => Binding_1.Binding.removeBindingsContaining(this))
                .then(() => this._channel.deleteExchange(this._name, {}))
                .then(() => this._channel.close())
                .then(() => this.removeConnection());
        }
        return this._deleting;
    }
    /**
     * Close this exchange.
     */
    close() {
        if (this._closing === undefined) {
            this._closing = this.initialized
                .then(() => Binding_1.Binding.removeBindingsContaining(this))
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
     * Create the reply queue to handle rpc resposne messages.
     * @param channel - AMQPlib Channel instance.
     */
    createReplyQueue(channel) {
        channel.setMaxListeners(0);
        channel.consume(DIRECT_REPLY_TO_QUEUE, (msg) => channel.emit(msg.properties.correlationId, msg), { noAck: true });
        return channel;
    }
    /**
     * Create exchange.
     * @param channel - AMQPlib Channel instance.
     */
    createExchange(channel) {
        this._channel = channel;
        const initializeExchange = this._options.noCreate
            ? channel.checkExchange(this._name)
            : channel.assertExchange(this._name, this._type, this._options);
        return new Promise((resolve, reject) => {
            initializeExchange
                .then((ok) => resolve(ok))
                .catch((err) => {
                exports.log("error", `Failed to create exchange '${this._name}'.`);
                delete this._connection._exchanges[this._name];
                reject(err);
            });
        });
    }
    /**
     * Invalidate this exchange & remove from connection
     */
    invalidateExchange() {
        delete this.initialized; // invalidate exchange
        delete this._connection._exchanges[this._name]; // remove the exchange from our administration
    }
    /**
     * Disattach channel & connection from this exchange
     */
    removeConnection() {
        delete this._channel;
        delete this._connection;
    }
}
exports.Exchange = Exchange;
//# sourceMappingURL=Exchange.js.map