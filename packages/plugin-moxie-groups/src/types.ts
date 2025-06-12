export interface GetGroupsInput {
    groupId?: string;
    groupName?: string;
    skip?: number;
    take?: number;
}

export type Group = {
    id: string;
    name: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    members: GroupMember[];
    status: Status;
}

export interface GroupMember {
    moxieUserId: string;
    createdAt: string;
    updatedAt: string;
    status: Status;
}

export enum Status {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE"
}

export interface CreateGroupInput {
    name: string;
}

export interface UpdateGroupInput {
    groupId: string;
    name?: string;
    groupStatus?: Status;
}

export interface ModifyGroupMembersInput {
    groupId: string;
    members: string[];
}

export interface GenerateUniqueGroupNameInput {
    groupBaseName: string;
}

export interface DeleteGroupInput {
    groupId: string;
    groupName?: string;
}

export interface GroupOutput {
    success: boolean;
    message: string;
    group?: Group;
    membersNotAdded?: string[];
}

export interface DeleteGroupOutput {
    success: boolean;
}

export interface GetGroupsOutput {
    groups: Group[];
    pagination: Pagination;
}

export interface Pagination {
    total: number;
    skip: number;
    take: number;
}