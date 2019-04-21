import { Channel as _Channel } from "amqplib";
import { Connection } from "./Connection";

export interface Node {
  // ===========================================================================
  //  Fields
  // ===========================================================================
  initialized: Promise<any>;

  _connection: Connection;
  _channel: _Channel;
  _name: string;
  _options: Options;

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

export interface Options {
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: any;
  noCreate?: boolean;
}
