"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopCompose = exports.deployCompose = exports.listComposes = exports.deleteCompose = exports.updateCompose = exports.createCompose = exports.findComposeById = void 0;
// Mock implementation for development
var mockComposes = [];
/**
 * Find a compose configuration by ID
 */
var findComposeById = function (id) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        // In a real implementation, this would query the database
        return [2 /*return*/, mockComposes.find(function (compose) { return compose.id === id; }) || null];
    });
}); };
exports.findComposeById = findComposeById;
/**
 * Create a new compose configuration
 */
var createCompose = function (name, specification, serverId, appName, description) { return __awaiter(void 0, void 0, void 0, function () {
    var id, now, newCompose;
    return __generator(this, function (_a) {
        id = "compose_".concat(Date.now());
        now = new Date().toISOString();
        newCompose = {
            id: id,
            name: name,
            appName: appName || null,
            createdAt: now,
            description: description || null,
            specification: specification,
            serverId: serverId,
            lastDeployedAt: null,
            status: "idle",
            errorMessage: null,
        };
        mockComposes.push(newCompose);
        return [2 /*return*/, newCompose];
    });
}); };
exports.createCompose = createCompose;
/**
 * Update an existing compose configuration
 */
var updateCompose = function (id, data) { return __awaiter(void 0, void 0, void 0, function () {
    var index, existingCompose;
    var _a, _b, _c;
    return __generator(this, function (_d) {
        index = mockComposes.findIndex(function (compose) { return compose.id === id; });
        if (index === -1)
            return [2 /*return*/, null];
        existingCompose = mockComposes[index];
        if (!existingCompose)
            return [2 /*return*/, null];
        // Ensure all required fields are preserved
        mockComposes[index] = __assign(__assign(__assign({}, existingCompose), data), { id: existingCompose.id, createdAt: existingCompose.createdAt, name: (_a = data.name) !== null && _a !== void 0 ? _a : existingCompose.name, specification: (_b = data.specification) !== null && _b !== void 0 ? _b : existingCompose.specification, serverId: (_c = data.serverId) !== null && _c !== void 0 ? _c : existingCompose.serverId // Ensure serverId is not undefined
         });
        return [2 /*return*/, mockComposes[index]];
    });
}); };
exports.updateCompose = updateCompose;
/**
 * Delete a compose configuration
 */
var deleteCompose = function (id) { return __awaiter(void 0, void 0, void 0, function () {
    var initialLength;
    return __generator(this, function (_a) {
        initialLength = mockComposes.length;
        mockComposes = mockComposes.filter(function (compose) { return compose.id !== id; });
        return [2 /*return*/, mockComposes.length < initialLength];
    });
}); };
exports.deleteCompose = deleteCompose;
/**
 * List all compose configurations, optionally filtered by server
 */
var listComposes = function (serverId) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        // In a real implementation, this would query the database
        if (serverId) {
            return [2 /*return*/, mockComposes.filter(function (compose) { return compose.serverId === serverId; })];
        }
        return [2 /*return*/, mockComposes];
    });
}); };
exports.listComposes = listComposes;
/**
 * Deploy a compose specification to a server
 */
var deployCompose = function (composeId, options) { return __awaiter(void 0, void 0, void 0, function () {
    var composeData, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.findComposeById)(composeId)];
            case 1:
                composeData = _a.sent();
                if (!composeData)
                    return [2 /*return*/, null];
                // Update status to deploying
                return [4 /*yield*/, (0, exports.updateCompose)(composeId, { status: "deploying" })];
            case 2:
                // Update status to deploying
                _a.sent();
                _a.label = 3;
            case 3:
                _a.trys.push([3, 6, , 8]);
                // Simulate deployment
                return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000); })];
            case 4:
                // Simulate deployment
                _a.sent();
                // Update status to deployed
                return [4 /*yield*/, (0, exports.updateCompose)(composeId, {
                        status: "deployed",
                        lastDeployedAt: new Date().toISOString()
                    })];
            case 5:
                // Update status to deployed
                _a.sent();
                return [2 /*return*/, (0, exports.findComposeById)(composeId)];
            case 6:
                error_1 = _a.sent();
                // Update status to error
                return [4 /*yield*/, (0, exports.updateCompose)(composeId, {
                        status: "error",
                        errorMessage: error_1 instanceof Error ? error_1.message : String(error_1)
                    })];
            case 7:
                // Update status to error
                _a.sent();
                return [2 /*return*/, (0, exports.findComposeById)(composeId)];
            case 8: return [2 /*return*/];
        }
    });
}); };
exports.deployCompose = deployCompose;
/**
 * Stop a deployed compose application
 */
var stopCompose = function (composeId, options) { return __awaiter(void 0, void 0, void 0, function () {
    var composeData, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.findComposeById)(composeId)];
            case 1:
                composeData = _a.sent();
                if (!composeData)
                    return [2 /*return*/, null];
                _a.label = 2;
            case 2:
                _a.trys.push([2, 5, , 7]);
                // Simulate stopping
                return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000); })];
            case 3:
                // Simulate stopping
                _a.sent();
                // Update status to idle
                return [4 /*yield*/, (0, exports.updateCompose)(composeId, { status: "idle" })];
            case 4:
                // Update status to idle
                _a.sent();
                return [2 /*return*/, (0, exports.findComposeById)(composeId)];
            case 5:
                error_2 = _a.sent();
                // Update status to error
                return [4 /*yield*/, (0, exports.updateCompose)(composeId, {
                        status: "error",
                        errorMessage: error_2 instanceof Error ? error_2.message : String(error_2)
                    })];
            case 6:
                // Update status to error
                _a.sent();
                return [2 /*return*/, (0, exports.findComposeById)(composeId)];
            case 7: return [2 /*return*/];
        }
    });
}); };
exports.stopCompose = stopCompose;
