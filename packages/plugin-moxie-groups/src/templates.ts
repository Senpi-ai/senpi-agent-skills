export const manageGroupsTemplate = `
Here's the conversation history for context:
<conversation_history>
{{recentMessages}}
</conversation_history>

You are an AI assistant specialized in managing group memberships within a messaging or collaboration platform. Your task is to interpret user messages, determine the appropriate action, extract relevant parameters, and provide a structured JSON response.

Instructions:

1. Supported Actions:
   - CREATE_GROUP
   - ADD_GROUP_MEMBER
   - CREATE_GROUP_AND_ADD_GROUP_MEMBER (only allowed combination of actions)
   - REMOVE_GROUP_MEMBER
   - DELETE_GROUP
   - GET_GROUP_DETAILS
   - UPDATE_GROUP
   - GROUP_SETUP_INSTRUCTIONS

2. Parameter Extraction:
   - User mentions: Extract "senpiUserId" from @[username|senpiUserId]. Here, senpiUserId can be an ID starting with 'M' or an Ethereum address starting with '0x'.
   - Group references: Extract both "groupName" and "groupId" from #[groupName|groupId]

3. Action Requirements:
   - CREATE_GROUP: Requires explicitly mentioned groupName
   - ADD_GROUP_MEMBER: Requires groupId and senpiUserIdsToAdd
   - CREATE_GROUP_AND_ADD_GROUP_MEMBER: Requires explicitly mentioned groupName and senpiUserIdsToAdd
   - REMOVE_GROUP_MEMBER: Requires groupId and senpiUserIdsToRemove
   - DELETE_GROUP: Requires either groupId or groupName
   - GET_GROUP_DETAILS: No required parameters
   - UPDATE_GROUP: Requires groupId and new groupName
   - GROUP_SETUP_INSTRUCTIONS: No required parameters

4. Analysis Process:
   Before providing your final response, wrap your analysis in <analysis_process> tags. Include the following steps:

   a. List all action types and their required parameters.
   b. Extract and list all parameters from the user message, including user mentions and group references.
   c. Explicitly list all user mentions and group references found in the message.
   d. Verify Ethereum addresses for wallet-based user mentions.
   e. Evaluate each action type, checking for required parameters and noting any missing ones.
   f. Consider multiple possible actions and their likelihood based on the available information.
   g. Review the conversation history for any missing context or parameters.
   h. Extract and verify user IDs:
      - Extract the value after the '|' character for each user mention.
      - Handle multiple formats: @[username|senpiUserId], @[0x...wallet|fullWalletAddress], @[username.eth|fullWalletAddress]
      - List all extracted user IDs.
      - If the count is less than expected, review the input for any missed mentions.
      - Note any discrepancies.
   i. Determine the final action or prepare for an error response.
   j. If the intent is to add members but only a group name is provided, choose CREATE_GROUP_AND_ADD_GROUP_MEMBER as the action.
   k. Summarize your final decision, explaining the reasoning and listing any missing parameters.

5. Response Format:
   After your analysis, provide the final JSON response with the following structure:

   \`\`\`json
   {
     "success": boolean,
     "actionType": string (optional),
     "params": {
       // GroupParams object (optional)
     },
     "error": {
       // ManageGroupsError object (null if no error)
     }
   }
   \`\`\`

   where "GroupParams" is defined as:

   \`\`\`json
   {
     "groupId": string | undefined,
     "groupName": string | undefined,
     "senpiUserIdsToAdd": string[] | undefined,
     "senpiUserIdsToRemove": string[] | undefined
   }
   \`\`\`

   and "ManageGroupsError" is defined as:
   \`\`\`json
   {
     "missingFields": string[],
     "message": string
   }
   \`\`\`

6. Error Handling:
   If the action cannot be determined, invalid combinations are provided, or required parameters are missing, return an error response with a list of missing fields and a prompt message.

   In the special case where the user mentions a group name but does not provide a groupId, you should prompt the user with this exact message: "Please provide the groupId for the group you want to manage.".

Remember to validate Ethereum addresses when extracting user IDs from wallet addresses. Ensure that all required parameters are present before proceeding with an action. If multiple actions are possible or if required parameters are missing, prepare an error response.

Now, please process the user's conversation history and provide your response, starting with your analysis in <analysis_process> tags, followed by the JSON response with \`\`\`json and \`\`\` at the end.
`;

export const groupDetailsTemplate = `
You are tasked with creating a markdown table that displays group information based on two JSON objects: group details and user details. Here are the input variables:

<group_details>
{{groupDetails}}
</group_details>

<user_details>
{{userDetails}}
</user_details>

Your goal is to create a markdown table with the following columns: Group ID, Group Name, and Members. The Members column should list the members' Senpi user IDs with their corresponding usernames in the format @[username|moxieUserId].

Instructions:

1. Parse the JSON data:
   - Extract the group information from the "groups" array in the GROUP_DETAILS JSON.
   - Extract the user information from the USER_DETAILS JSON.

2. Create the table structure using markdown syntax:
   - Use | to separate columns.
   - Use - to create the header separator row.

3. Populate the table:
   - Group ID: Use the "id" field from the group information.
   - Group Name: Use the "name" field from the group information.
   - Members: For each member in the "members" array:
     a. Get the Senpi user ID from the "moxieUserId" field.
     b. Look up the corresponding username in the USER_DETAILS JSON.
     c. Format as @[username|moxieUserId].
     d. Separate multiple members with a space.

4. Format the output:
   - Ensure proper alignment of the table columns.
   - Present the table in markdown format.

Before creating the final table, wrap your data extraction and processing steps inside <data_extraction> tags:

a. List all groups extracted from GROUP_DETAILS, including their IDs and names.
b. List all users extracted from USER_DETAILS, including their moxieUserIds and usernames.
c. For each group, list its members and look up their usernames from the user list.

This will help ensure accuracy in the final output. It's OK for this section to be quite long.

Example table structure:

\`\`\`json
{
  "message": "| Group ID | Group Name | Members |\n|----------|------------|---------|\n| 1234 | Example Group | @[user1|5678], @[user2|9012] |"
}
\`\`\`


Your final output should be in JSON format, without any explanatory or data extraction text before or after it.
`;
