import { Entity, MikroORM, PrimaryKey, Property } from '@mikro-orm/core'
import { defineConfig } from '@mikro-orm/better-sqlite'
import test, { afterEach, beforeEach } from 'node:test'
import { createEvent, createStore } from 'effector'
import { sideEffect, wrapEffectorMikroorm } from './index'
import assert from 'node:assert'

let orm: MikroORM

@Entity()
class TestEntity {
  constructor(ent: TestEntity) {
    Object.entries(ent).forEach(([key, val]) => Reflect.set(this, key, val))
  }

  @PrimaryKey()
  id!: number

  @Property()
  value!: string
}

const createTestEntity = createEvent<TestEntity>()
const $store = createStore<TestEntity | null>(null, { sid: '$store' })

beforeEach(async () => {
  orm = await MikroORM.init(
    defineConfig({
      // dbName: 'test.sqlite',
      dbName: ':memory:',
      debug: true,
      entities: [TestEntity],
    })
  )
  await orm.getSchemaGenerator().dropSchema()
  await orm.getSchemaGenerator().createSchema()
  await orm.getSchemaGenerator().refreshDatabase()
  await orm.getSchemaGenerator().clearDatabase()
})

afterEach(async () => {
  $store.off(createTestEntity)
  await orm.close()
})

test('persistance works on event <-> store', async () => {
  $store.on(createTestEntity, (_, entity) => entity)

  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
  })

  const persisted = await orm.em.fork().findOne(TestEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test')
})
