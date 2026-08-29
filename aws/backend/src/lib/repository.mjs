import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

export class DynamoRepository {
  constructor(client = documentClient) {
    this.client = client;
  }

  async get(tableName, key) {
    const result = await this.client.send(new GetCommand({ TableName: tableName, Key: key }));
    return result.Item || null;
  }

  async put(tableName, item, options = {}) {
    await this.client.send(new PutCommand({ TableName: tableName, Item: item, ...options }));
    return item;
  }

  async scan(tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await this.client.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async query(tableName, indexName, keyName, keyValue) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: "#key = :value",
        ExpressionAttributeNames: { "#key": keyName },
        ExpressionAttributeValues: { ":value": keyValue },
        ExclusiveStartKey
      }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async update(tableName, key, changes, options = {}) {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};
    const assignments = entries.map(([name, value], index) => {
      ExpressionAttributeNames[`#field${index}`] = name;
      ExpressionAttributeValues[`:value${index}`] = value;
      return `#field${index} = :value${index}`;
    });
    const result = await this.client.send(new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ExpressionAttributeNames: { ...ExpressionAttributeNames, ...(options.ExpressionAttributeNames || {}) },
      ExpressionAttributeValues: { ...ExpressionAttributeValues, ...(options.ExpressionAttributeValues || {}) },
      ConditionExpression: options.ConditionExpression,
      ReturnValues: "ALL_NEW"
    }));
    return result.Attributes;
  }

  async transact(items) {
    await this.client.send(new TransactWriteCommand({ TransactItems: items }));
  }
}

export const repository = new DynamoRepository();
