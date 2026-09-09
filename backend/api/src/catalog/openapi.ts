import type { SchemaObject } from '@nestjs/swagger';
import { accountTypes, type CatalogCommand } from '@finanzas/domain';
export function commandSchema(type: CatalogCommand['type']): SchemaObject {
  const create = type.endsWith('.create'),
    account = type.startsWith('account.'),
    initialize = type === 'category.initialize';
  const fields: Record<string, SchemaObject> = {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      description: 'NFC recortado, sin controles',
    },
    state: {
      type: 'string',
      enum: create ? ['active'] : account ? ['active', 'inactive'] : ['active', 'archived'],
    },
    position: { type: 'integer', minimum: 0, maximum: 2147483647 },
  };
  if (account) fields['type'] = { type: 'string', enum: [...accountTypes] };
  if (create)
    fields[account ? 'currency' : 'kind'] = {
      type: 'string',
      enum: account ? ['PEN', 'USD'] : ['expense', 'income'],
    };
  const command: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: initialize ? ['type'] : ['type', 'id', 'payload'],
    properties: { type: { type: 'string', enum: [type] } },
  };
  if (!initialize)
    Object.assign(command.properties!, {
      id: { type: 'string', format: 'uuid' },
      payload: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: fields,
        ...(create ? { required: Object.keys(fields) } : {}),
      },
    });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['operationId', 'deviceId', 'schemaVersion', 'baseVersion', 'command'],
    properties: {
      operationId: {
        type: 'string',
        format: 'uuid',
        description: 'Idempotencia por usuario y espacio catálogo',
      },
      deviceId: { type: 'string', format: 'uuid' },
      schemaVersion: { type: 'integer', enum: [1] },
      baseVersion: {
        type: 'string',
        pattern: create || initialize ? '^0$' : '^[1-9][0-9]{0,18}$',
        description: 'Versión esperada, máximo BIGINT positivo',
      },
      command,
    },
  };
}
