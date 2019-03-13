import winston from "winston";

import { Replies } from "amqplib";
import { Exchange } from "./Exchange";
import { INode } from "./INode";
import { Queue } from "./Queue";

// create a custom winston logger for amqp-ts
const amqpLog = winston.createLogger({
  transports: [new winston.transports.Console()]
});

const log = (type: string, message: string) => {
  amqpLog.log(type, message, { module: "Binding" });
};

export class Binding {
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
  public static id(destination: INode, source: INode, pattern: string = ""): string {
    const srcString = source._name;
    const dstString = destination._name;
    const typeString = destination instanceof Queue ? "Queue" : "Exchange";
    return `[${srcString}]to${typeString}[${dstString}]${pattern}`;
  }

  /**
   * Remove bindings attached to connectionPoint.
   * @param connectionPoint - MQ node
   * @returns Promise that fulfills once all bindings are removed.
   */
  public static removeBindingsContaining(connectionPoint: INode): Promise<any> {
    const connection = connectionPoint._connection;
    const promises: Array<Promise<void>> = [];
    for (const bindingId of Object.keys(connection._bindings)) {
      const binding: Binding = connection._bindings[bindingId];
      if (binding._source === connectionPoint || binding._destination === connectionPoint) {
        promises.push(binding.delete());
      }
    }
    return Promise.all(promises);
  }

  // ===========================================================================
  //  Fields
  // ===========================================================================
  public initialized: Promise<Binding>;

  public _source: Exchange;
  public _destination: INode;
  public _pattern: string;
  public _args: any;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(destination: INode, source: INode, pattern = "", args: any = {}) {
    if (!(source instanceof Exchange)) {
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
  public _initialize(): void {
    const srcName = this._source._name;
    const dstName = this._destination._name;

    this.initialized = new Promise<Binding>((resolve, reject) => {
      /**
       * Create binding.
       */
      const bind = async (): Promise<Replies.Empty> => {
        if (this._destination instanceof Queue) {
          return this._destination.initialized.then(() =>
            this._destination._channel.bindQueue(dstName, srcName, this._pattern, this._args)
          );
        } else {
          return this._destination.initialized.then(() =>
            this._destination._channel.bindExchange(dstName, srcName, this._pattern, this._args)
          );
        }
      };

      bind()
        .then((_ok) => resolve(this))
        .catch((err) => {
          log("error", `Failed to create exchange binding (${srcName}->${dstName})`);
          delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
          reject(err);
        });
    });
  }

  /**
   * Delete binding.
   * @returns Promise that fulfills once binding has been deleted.
   */
  public async delete(): Promise<void> {
    const srcName = this._source._name;
    const dstName = this._destination._name;

    /**
     * Delete binding.
     */
    const unbind = async (): Promise<Replies.Empty> => {
      if (this._destination instanceof Queue) {
        const queue = this._destination;
        return queue.initialized.then(() => queue._channel.unbindQueue(dstName, srcName, this._pattern, this._args));
      } else {
        const exchange = this._destination;
        return exchange.initialized.then(() =>
          exchange._channel.unbindExchange(dstName, srcName, this._pattern, this._args)
        );
      }
    };

    return unbind().then((_ok) => {
      delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
    });
  }
}
