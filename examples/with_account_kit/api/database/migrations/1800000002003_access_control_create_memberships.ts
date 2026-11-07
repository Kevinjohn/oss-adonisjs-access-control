import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'memberships'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('scope_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('teams')
        .onDelete('RESTRICT')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table.string('role', 32).notNullable()
      table.string('status', 16).notNullable().defaultTo('active')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['scope_id', 'user_id'], { indexName: 'memberships_scope_user_unique' })
      table.index(['user_id'], 'memberships_user_index')
      table.index(['scope_id', 'created_at', 'id'], 'memberships_scope_page_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
