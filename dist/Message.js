"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
// import { Exchange } from "./Exchange";
const Queue_1 = require("./Queue");
// create a custom winston logger for amqp-ts
const amqpLog = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()]
});
exports.log = (type, message) => {
    amqpLog.log(type, message, { module: "Message" });
};
class Message {
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(content, properties = {}, fields = {}) {
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
    setContent(content) {
        if (typeof content === "string") {
            this.content = Buffer.from(content);
        }
        else if (!(content instanceof Buffer)) {
            this.content = Buffer.from(JSON.stringify(content));
            this.properties.contentType = "application/json";
        }
        else {
            this.content = content;
        }
    }
    /**
     * Get the content of the message.
     * @returns The content of the message.
     */
    getContent() {
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
    sendTo(destination, routingKey = "") {
        // inline function to send the message
        const sendMessage = () => {
            try {
                destination._channel.publish(exchange, routingKey, this.content, this.properties);
            }
            catch (err) {
                exports.log("debug", "Publish error: " + err.message);
                exports.log("debug", "Try to rebuild connection, before Call.");
                const connection = destination._connection;
                connection
                    ._rebuildAll(err)
                    .then(() => exports.log("debug", "Retransmitting message."))
                    .then(() => connection.initialized)
                    .then(() => this.sendTo(destination, routingKey))
                    .catch((err) => exports.log("error", err.message));
            }
        };
        let exchange;
        if (destination instanceof Queue_1.Queue) {
            exchange = "";
            routingKey = destination._name;
        }
        else {
            exchange = destination._name;
        }
        // execute sync when possible
        destination.initialized.then(sendMessage);
    }
    /**
     * Acknowledge message.
     * @param allUpTo - If true, all outstanding messages prior to and including
     *                  the given message shall be considered acknowledged.
     *                  Defaults to **false**
     */
    ack(allUpTo) {
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
    nack(allUpTo, requeue) {
        if (this._channel !== undefined) {
            this._channel.nack(this._message, allUpTo, requeue);
        }
    }
}
exports.Message = Message;
//# sourceMappingURL=Message.js.map