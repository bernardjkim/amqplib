import AMQPLib from "amqplib";

import { Binding } from "./Binding";
import { Connection } from "./Connection";

export interface INode {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  initialized: Promise<any>;

  _connection: Connection;
  _channel: AMQPLib.Channel;
  _name: string;
  _options: IOptions;

  _deleting: Promise<any>;
  _closing: Promise<void>;

  // ===========================================================================
  //  Methods
  // ===========================================================================

  /**
   * Initialize node.
   */
  _initialize(): void;

  /**
   * Delete this node.
   */
  delete(): Promise<any>;

  /**
   * Close this node.
   */
  close(): Promise<void>;
}

export interface IOptions {
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: any;
  noCreate?: boolean;
}
