import { Exchange } from "./Exchange";
import { INode } from "./INode";
export declare let log: (type: string, message: string) => void;
export declare class Binding {
    /**
     * Get the binding id.
     * @param destination - Destination node
     * @param source      - Source node
     * @param pattern     - Routing pattern
     * @returns Binding id.
     */
    static id(destination: INode, source: INode, pattern?: string): string;
    /**
     * Remove bindings attached to connectionPoint.
     * @param connectionPoint - MQ node
     * @returns Promise that fulfills once all bindings are removed.
     */
    static removeBindingsContaining(connectionPoint: INode): Promise<any>;
    initialized: Promise<Binding>;
    _source: Exchange;
    _destination: INode;
    _pattern: string;
    _args: any;
    constructor(destination: INode, source: INode, pattern?: string, args?: any);
    /**
     * Initialize binding.
     */
    _initialize(): void;
    /**
     * Delete binding.
     * @returns Promise that fulfills once binding has been deleted.
     */
    delete(): Promise<void>;
}
