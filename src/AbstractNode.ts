import AMQPLib from "amqplib";

import { Connection } from "./Connection";
import { INode, IOptions } from "./INode";

export abstract class AbstractNode implements INode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  public initialized: Promise<any>;

  public _connection: Connection;
  public _channel: AMQPLib.Channel;
  public _name: string;
  public _options: IOptions;

  public _deleting: Promise<any>;
  public _closing: Promise<void>;

  // ===========================================================================
  //  Constructor
  // ===========================================================================
  constructor(connection: Connection, name: string, options: IOptions = {}) {
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
  public abstract _initialize(): void;

  /**
   * Delete this node.
   */
  public abstract delete(): Promise<any>;

  /**
   * Close this queue.
   */
  public abstract close(): Promise<void>;
}
