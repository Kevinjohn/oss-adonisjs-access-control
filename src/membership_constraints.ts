import { RuntimeException } from '@adonisjs/core/exceptions'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

interface IndexColumn {
  name: string
  column_name: string | null
}

interface ForeignKeyColumn extends IndexColumn {
  parent: string
  parent_column: string | null
  deletion: string
}

interface MembershipSchema {
  table: string
  scopeTable: string
  usersTable: string
}

async function readSqliteConstraints(client: QueryClientContract, table: string) {
  const indexes = (await client.rawQuery(
    `select indexes.name, columns.name as column_name
       from pragma_index_list(?, 'main') as indexes
       join pragma_index_info(indexes.name, 'main') as columns
      where indexes."unique" = 1 and indexes.partial = 0`,
    [table]
  )) as IndexColumn[]
  const foreignKeys = (await client.rawQuery(
    `select id as name, "from" as column_name, "table" as parent,
            "to" as parent_column, on_delete as deletion
       from pragma_foreign_key_list(?, 'main')`,
    [table]
  )) as ForeignKeyColumn[]
  return { indexes, foreignKeys }
}

async function readPostgresConstraints(client: QueryClientContract, schema: MembershipSchema) {
  const { table, scopeTable, usersTable } = schema
  const indexes = (await client.rawQuery(
    `select idx.indexrelid as name, attr.attname as column_name
       from pg_index as idx
       cross join lateral unnest(idx.indkey) with ordinality as key(attnum, position)
       left join pg_attribute as attr on attr.attrelid = idx.indrelid and attr.attnum = key.attnum
      where idx.indrelid = to_regclass(quote_ident(?))
        and idx.indisunique and idx.indisvalid and idx.indisready and idx.indimmediate
        and idx.indpred is null and key.position <= idx.indnkeyatts`,
    [table]
  )) as { rows: IndexColumn[] }
  const foreignKeys = (await client.rawQuery(
    `select c.oid as name, local_column.attname as column_name,
            parent.relname as parent, parent_column.attname as parent_column,
            case c.confdeltype when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' end as deletion
       from pg_constraint as c
       join pg_class as parent on parent.oid = c.confrelid
       join pg_attribute as local_column
         on local_column.attrelid = c.conrelid and local_column.attnum = c.conkey[1]
       join pg_attribute as parent_column
         on parent_column.attrelid = c.confrelid and parent_column.attnum = c.confkey[1]
      where c.conrelid = to_regclass(quote_ident(?)) and c.contype = 'f' and c.convalidated
        and c.confrelid in (to_regclass(quote_ident(?)), to_regclass(quote_ident(?)))
        and cardinality(c.conkey) = 1`,
    [table, scopeTable, usersTable]
  )) as { rows: ForeignKeyColumn[] }
  return { indexes: indexes.rows, foreignKeys: foreignKeys.rows }
}

async function readMysqlConstraints(client: QueryClientContract, table: string) {
  const [indexes] = (await client.rawQuery(
    `select index_name as name, case when sub_part is null then column_name end as column_name
       from information_schema.statistics
      where table_schema = database() and binary table_name = ? and non_unique = 0`,
    [table]
  )) as [IndexColumn[], unknown]
  const [foreignKeys] = (await client.rawQuery(
    `select k.constraint_name as name, k.column_name as column_name, k.referenced_table_name as parent,
            k.referenced_column_name as parent_column, r.delete_rule as deletion
       from information_schema.key_column_usage as k
       join information_schema.referential_constraints as r
         on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name
        and r.table_name = k.table_name
      where k.table_schema = database() and binary k.table_name = ?
        and k.referenced_table_schema = database()`,
    [table]
  )) as [ForeignKeyColumn[], unknown]
  return { indexes, foreignKeys }
}

function groupColumns<T extends IndexColumn>(columns: T[]) {
  const byConstraint = new Map<string, T[]>()
  for (const column of columns) {
    const group = byConstraint.get(column.name)
    if (group) group.push(column)
    else byConstraint.set(column.name, [column])
  }
  return [...byConstraint.values()]
}

function readConstraints(client: QueryClientContract, schema: MembershipSchema) {
  switch (client.dialect.name) {
    case 'sqlite3':
    case 'better-sqlite3':
      return readSqliteConstraints(client, schema.table)
    case 'postgres':
      return readPostgresConstraints(client, schema)
    case 'mysql':
      return readMysqlConstraints(client, schema.table)
    default:
      throw new RuntimeException(
        `access-control: cannot inspect membership constraints on ${client.dialect.name}`
      )
  }
}

/** Reads the structural membership guarantees from the configured database. */
export async function inspectMembershipConstraints(
  client: QueryClientContract,
  schema: MembershipSchema
) {
  const { indexes, foreignKeys } = await readConstraints(client, schema)
  const hasUniquePair = groupColumns(indexes).some((index) => {
    const columns = index.map((entry) => entry.column_name)
    return columns.length === 2 && columns.includes('scope_id') && columns.includes('user_id')
  })
  const singleColumnReferences = groupColumns(foreignKeys).filter((group) => group.length === 1)
  const hasReference = (column: string, parent: string) =>
    singleColumnReferences.some(
      ([key]) =>
        key.column_name === column &&
        key.parent === parent &&
        key.parent_column === 'id' &&
        (key.deletion === 'RESTRICT' || key.deletion === 'NO ACTION')
    )

  return {
    hasUniquePair,
    hasScopeReference: hasReference('scope_id', schema.scopeTable),
    hasUserReference: hasReference('user_id', schema.usersTable),
  }
}
