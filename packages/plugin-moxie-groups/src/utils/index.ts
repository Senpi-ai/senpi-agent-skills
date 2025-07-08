import { elizaLogger } from '@moxie-protocol/core';
import { gql } from 'graphql-request';
import { GetGroupsInput, GetGroupsOutput, GroupOutput, CreateGroupInput, UpdateGroupInput, DeleteGroupInput, ModifyGroupMembersInput, Status, DeleteGroupOutput, GenerateUniqueGroupNameInput } from '../types';

export const GET_GROUP_DETAILS = gql`
    query GetGroups($input: GetGroupsInput!) {
        GetGroups(input: $input) {
            groups {
                id
                name
                createdBy
                members {
                    moxieUserId
                }
            }
        }
    }
`;

export const CREATE_GROUP = gql`
    mutation CreateGroup($input: CreateGroupInput!) {
        CreateGroup(input: $input) {
            success
            message
            group {
                id
                name
                createdBy
                members {
                    moxieUserId
                }
            }
        }
    }
`;

export const UPDATE_GROUP = gql`
    mutation UpdateGroup($input: UpdateGroupInput!) {
        UpdateGroup(input: $input) {
            success
            message
            group {
                id
                name
                createdBy
                createdAt
                updatedAt
                members {
                    moxieUserId
                    createdAt
                    updatedAt
                    status
                }
                status
            }
            membersNotAdded
        }
    }
`;

export const DELETE_GROUP = gql`
    mutation DeleteGroup($input: DeleteGroupInput!) {
        DeleteGroup(input: $input) {
            success
        }
    }
`;

export const ADD_MEMBERS_TO_GROUP = gql`
    mutation AddMembersToGroup($input: ModifyGroupMembersInput!) {
        AddMembersToGroup(input: $input) {
            success
            message
            group {
                id
                name
                createdBy
                createdAt
                updatedAt
                members {
                    moxieUserId
                    createdAt
                    updatedAt
                    status
                }
                status
            }
            membersNotAdded
        }
    }
`;

export const REMOVE_MEMBERS_FROM_GROUP = gql`
    mutation RemoveMembersFromGroup($input: ModifyGroupMembersInput!) {
        RemoveMembersFromGroup(input: $input) {
            success
            message
            group {
                id
                name
                createdBy
                createdAt
                updatedAt
                members {
                    moxieUserId
                    createdAt
                    updatedAt
                    status
                }
                status
            }
            membersNotAdded
        }
    }
`;

export const GENERATE_UNIQUE_GROUP_NAME = gql`
    query GenerateUniqueGroupName($input: GenerateUniqueGroupNameInput!) {
        GenerateUniqueGroupName(input: $input) {
            groupName
        }
    }
`;

export async function getGroupDetails(
    authorizationHeader: string,
    groupId?: string,
    groupName?: string,
    skip: number = 0,
    take: number = 10,
): Promise<GetGroupsOutput> {
    elizaLogger.info('getGroupDetails called', { groupId, groupName, skip, take });

    try {
        const input: GetGroupsInput = {
            ...(groupId && { groupId }),
            ...(groupName && { groupName }),
            ...(skip !== undefined && { skip }),
            ...(take !== undefined && { take })
        };

        elizaLogger.debug('getGroupDetails input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: GET_GROUP_DETAILS,
                variables: { input }
            })
        });

        elizaLogger.debug('getGroups fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('getGroups failed', { errors: result.errors });
            throw new Error(`Failed to get groups: ${result.errors[0].message}`);
        }

        elizaLogger.info('getGroups successful', { data: result.data.GetGroups });
        return result.data.GetGroups;
    } catch (error) {
        elizaLogger.error('Error in getGroups', { error: error.message });
        throw new Error(`Error fetching groups: ${error.message}`);
    }
}

export async function createGroup(
    authorizationHeader: string,
    name: string
): Promise<GroupOutput> {
    elizaLogger.info('createGroup called', { name });

    try {

        const input: CreateGroupInput = { name };
        elizaLogger.debug('createGroup input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: CREATE_GROUP,
                variables: { input }
            })
        });

        elizaLogger.debug('createGroup fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('createGroup failed', { errors: result.errors });
            throw new Error(`Failed to create group: ${result.errors[0].message}`);
        }

        elizaLogger.info('createGroup successful', { data: result.data.CreateGroup });
        return result.data.CreateGroup;
    } catch (error) {
        elizaLogger.error('Error in createGroup', { error: error.message });
        throw new Error(`Error creating group: ${error.message}`);
    }
}

export async function updateGroup(
    authorizationHeader: string,
    groupId: string,
    name?: string,
    groupStatus?: Status
): Promise<GroupOutput> {
    elizaLogger.info('updateGroup called', { groupId, name, groupStatus });

    try {
        const input: UpdateGroupInput = { groupId, ...(name && { name }), ...(groupStatus && { groupStatus }) };
        elizaLogger.debug('updateGroup input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: UPDATE_GROUP,
                variables: { input }
            })
        });

        elizaLogger.debug('updateGroup fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('updateGroup failed', { errors: result.errors });
            throw new Error(`Failed to update group: ${result.errors[0].message}`);
        }

        elizaLogger.info('updateGroup successful', { data: result.data.UpdateGroup });
        return result.data.UpdateGroup;
    } catch (error) {
        elizaLogger.error('Error in updateGroup', { error: error.message });
        throw new Error(`Error updating group: ${error.message}`);
    }
}

export async function deleteGroup(
    authorizationHeader: string,
    groupId: string,
    groupName?: string
): Promise<DeleteGroupOutput> {
    elizaLogger.info('deleteGroup called', { groupId, groupName });

    try {

        const input: DeleteGroupInput = { groupId, ...(groupName && { groupName }) };
        elizaLogger.debug('deleteGroup input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: DELETE_GROUP,
                variables: { input }
            })
        });

        elizaLogger.debug('deleteGroup fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('deleteGroup failed', { errors: result.errors });
            throw new Error(`Failed to delete group: ${result.errors[0].message}`);
        }

        elizaLogger.info('deleteGroup successful', { data: result.data.DeleteGroup });
        return result.data.DeleteGroup;
    } catch (error) {
        elizaLogger.error('Error in deleteGroup', { error: error.message });
        throw new Error(`Error deleting group: ${error.message}`);
    }
}

export async function addMembersToGroup(
    authorizationHeader: string,
    groupId: string,
    members: string[]
): Promise<GroupOutput> {
    elizaLogger.info('addMembersToGroup called', { groupId, members });

    try {

        const input: ModifyGroupMembersInput = { groupId, members };
        elizaLogger.debug('addMembersToGroup input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: ADD_MEMBERS_TO_GROUP,
                variables: { input }
            })
        });

        elizaLogger.debug('addMembersToGroup fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('addMembersToGroup failed', { errors: result.errors });
            throw new Error(`Failed to add members to group: ${result.errors[0].message}`);
        }

        elizaLogger.info('addMembersToGroup successful', { data: result.data.AddMembersToGroup });
        return result.data.AddMembersToGroup;
    } catch (error) {
        elizaLogger.error('Error in addMembersToGroup', { error: error.message });
        throw new Error(`Error adding members to group: ${error.message}`);
    }
}

export async function removeMembersFromGroup(
    authorizationHeader: string,
    groupId: string,
    members: string[]
): Promise<GroupOutput> {
    elizaLogger.info('removeMembersFromGroup called', { groupId, members });

    try {

        const input: ModifyGroupMembersInput = { groupId, members };
        elizaLogger.debug('removeMembersFromGroup input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: REMOVE_MEMBERS_FROM_GROUP,
                variables: { input }
            })
        });

        elizaLogger.debug('removeMembersFromGroup fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('removeMembersFromGroup failed', { errors: result.errors });
            throw new Error(`Failed to remove members from group: ${result.errors[0].message}`);
        }

        elizaLogger.info('removeMembersFromGroup successful', { data: result.data.RemoveMembersFromGroup });
        return result.data.RemoveMembersFromGroup;
    } catch (error) {
        elizaLogger.error('Error in removeMembersFromGroup', { error: error.message });
        throw new Error(`Error removing members from group: ${error.message}`);
    }
}

export async function generateUniqueGroupName(authorizationHeader: string, groupBaseName: string): Promise<string> {
    elizaLogger.info('generateUniqueGroupName called', { groupBaseName });

    try {
        const input: GenerateUniqueGroupNameInput = { groupBaseName };
        elizaLogger.debug('generateUniqueGroupName input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: GENERATE_UNIQUE_GROUP_NAME,
                variables: { input }
            })
        });

        elizaLogger.debug('generateUniqueGroupName fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('generateUniqueGroupName failed', { errors: result.errors });
            throw new Error(`Failed to generate unique group name: ${result.errors[0].message}`);
        }

        elizaLogger.info('generateUniqueGroupName successful', { data: result.data.GenerateUniqueGroupName });
        return result.data.GenerateUniqueGroupName.groupName;
    } catch (error) {
        elizaLogger.error('Error in generateUniqueGroupName', { error: error.message });
        throw new Error(`Error generating unique group name: ${error.message}`);
    }
}

const errorMessages: Record<string, string> = {
    AERR100: "The user does not have ownership rights for this group.",
    AERR101: "Please provide a valid group name.",
    AERR102: "Group names must not begin with special characters such as #, $, or @.",
    AERR103: "A group with this name already exists. Please choose a different name.",
    AERR104: "A valid group ID is required to update group details.",
    AERR105: "The user does not have ownership rights to update the group details.",
    AERR106: "A valid group ID is required to delete the group.",
    AERR107: "The user does not have ownership rights to delete the group.",
    AERR108: "Members must be specified to add them to the group.",
    AERR109: "A maximum of 100 members can be added to the group.",
    AERR110: "The provided Senpi user IDs are invalid for adding members to the group.",
    AERR111: "You cannot add yourself to the group.",
    AERR112: "The user does not have ownership rights to add members to the group.",
    AERR113: "Duplicate members cannot be added to the group.",
    AERR114: "A valid group ID is required to remove members from the group.",
    AERR115: "The user does not have ownership rights to remove members from the group.",
    AERR116: "The specified members are not part of the group.",
    AERR117: "The user is not authorized to perform this action.",
    AERR118: "The specified user could not be found.",
};
  
export function getErrorMessageFromCode(error: Error | string): string {
    const errorMsg = typeof error === "string" ? error : error.message;
    const match = errorMsg.match(/(AERR\d{3})/);
    const code = match?.[1];
    return code && errorMessages[code]
        ? errorMessages[code]
        : "Something went wrong. Please check your input or try again.";
}