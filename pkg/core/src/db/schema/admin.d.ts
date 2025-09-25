export declare function findAdmin(): Promise<null>;
export declare function updateAdmin(adminId: string, data: any): Promise<null>;
export declare function findUserById(userId: string): Promise<null>;
declare const _default: {
    findAdmin: typeof findAdmin;
    updateAdmin: typeof updateAdmin;
    findUserById: typeof findUserById;
};
export default _default;
