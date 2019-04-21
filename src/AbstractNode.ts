import { Channel } from "amqplib";

import { Connection } from "./Connection";
import { Node, Options } from "./Node";

export abstract class AbstractNode implements Node {
  // ===========================================================================
  //  Fields
  // ===========================================================================

  initialized!: Promise<any>;

  _connection!: Connection;
  _name!: string;
  _options!: Options;

  _channel!: Channel;
  _deleting!: Promise<any>;
  _closing!: Promise<void>;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, options: Options = {}) {
    this._connection = connection;
    this._name = name;
    this._options = options;
  }

  // ===========================================================================
  //  Public
  // ===========================================================================

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
