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
const Exchange_1 = require("./Exchange");
const Queue_1 = require("./Queue");
// create a custom winston logger for amqp-ts
const amqpLog = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()]
});
exports.log = (type, message) => {
    amqpLog.log(type, message, { module: "Binding" });
};
class Binding {
    // ===========================================================================
    //  Statics
    // ===========================================================================
    /**
     * Get the binding id.
     * @param destination - Destination node
     * @param source      - Source node
     * @param pattern     - Routing pattern
     * @returns Binding id.
     */
    static id(destination, source, pattern = "") {
        const srcString = source._name;
        const dstString = destination._name;
        const typeString = destination instanceof Queue_1.Queue ? "Queue" : "Exchange";
        return `[${srcString}]to${typeString}[${dstString}]${pattern}`;
    }
    /**
     * Remove bindings attached to connectionPoint.
     * @param connectionPoint - MQ node
     * @returns Promise that fulfills once all bindings are removed.
     */
    static removeBindingsContaining(connectionPoint) {
        const connection = connectionPoint._connection;
        const promises = [];
        for (const bindingId of Object.keys(connection._bindings)) {
            const binding = connection._bindings[bindingId];
            if (binding._source === connectionPoint || binding._destination === connectionPoint) {
                promises.push(binding.delete());
            }
        }
        return Promise.all(promises);
    }
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(destination, source, pattern = "", args = {}) {
        if (!(source instanceof Exchange_1.Exchange)) {
            throw new Error("Source node must be an Exchange.");
        }
        this._source = source;
        this._destination = destination;
        this._pattern = pattern;
        this._args = args;
        this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)] = this;
        this._initialize();
    }
    // ===========================================================================
    //  Public
    // ===========================================================================
    /**
     * Initialize binding.
     */
    _initialize() {
        const srcName = this._source._name;
        const dstName = this._destination._name;
        this.initialized = new Promise((resolve, reject) => {
            /**
             * Create binding.
             */
            const bind = () => __awaiter(this, void 0, void 0, function* () {
                if (this._destination instanceof Queue_1.Queue) {
                    return this._destination.initialized.then(() => this._destination._channel.bindQueue(dstName, srcName, this._pattern, this._args));
                }
                else {
                    return this._destination.initialized.then(() => this._destination._channel.bindExchange(dstName, srcName, this._pattern, this._args));
                }
            });
            bind()
                .then((_ok) => resolve(this))
                .catch((err) => {
                exports.log("error", `Failed to create exchange binding (${srcName}->${dstName})`);
                delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
                reject(err);
            });
        });
    }
    /**
     * Delete binding.
     * @returns Promise that fulfills once binding has been deleted.
     */
    delete() {
        return __awaiter(this, void 0, void 0, function* () {
            const srcName = this._source._name;
            const dstName = this._destination._name;
            /**
             * Delete binding.
             */
            const unbind = () => __awaiter(this, void 0, void 0, function* () {
                if (this._destination instanceof Queue_1.Queue) {
                    const queue = this._destination;
                    return queue.initialized.then(() => queue._channel.unbindQueue(dstName, srcName, this._pattern, this._args));
                }
                else {
                    const exchange = this._destination;
                    return exchange.initialized.then(() => exchange._channel.unbindExchange(dstName, srcName, this._pattern, this._args));
                }
            });
            return unbind().then((_ok) => {
                delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
            });
        });
    }
}
exports.Binding = Binding;
//# sourceMappingURL=Binding.js.map