"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class AbstractNode {
    // ===========================================================================
    //  Constructor
    // ===========================================================================
    constructor(connection, name, options = {}) {
        this._connection = connection;
        this._name = name;
        this._options = options;
    }
}
exports.AbstractNode = AbstractNode;
//# sourceMappingURL=AbstractNode.js.map