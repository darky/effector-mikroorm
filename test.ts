import { Entity, EventArgs, EventSubscriber, MikroORM, PrimaryKey, Property } from '@mikro-orm/core'
import { defineConfig } from '@mikro-orm/better-sqlite'
import test, { afterEach, beforeEach } from 'node:test'
import { createEvent, createStore } from 'effector'
import { em, sideEffect, wrapEffectorMikroorm } from './index'
import assert from 'node:assert'

let orm: MikroORM
let insertedEntitiesViaEvent: unknown[] = []

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

@Entity()
class TestProjectionViaMapEntity {
  constructor(ent: TestProjectionViaMapEntity) {
    Object.entries(ent).forEach(([key, val]) => Reflect.set(this, key, val))
  }

  @PrimaryKey()
  id!: number

  @Property()
  value!: string
}

export class MikroORMEventsSubscriber implements EventSubscriber {
  async beforeCreate(args: EventArgs<unknown>): Promise<void> {
    insertedEntitiesViaEvent.push(args.entity)
  }
}

const createTestEntity = createEvent<TestEntity>()
const makeError = createEvent()

const $store = createStore<TestEntity | null>(null, { sid: '$store' })
$store.on(createTestEntity, (_, entity) => entity)

$store.map(ent => (ent ? new TestProjectionViaMapEntity({ ...ent, value: `${ent.value} projection` }) : ent))

const $error = createStore(null)
$error.on(makeError, () => {
  throw new Error('test-err')
})

beforeEach(async () => {
  orm = await MikroORM.init(
    defineConfig({
      // dbName: 'test.sqlite',
      dbName: ':memory:',
      debug: true,
      entities: [TestEntity, TestProjectionViaMapEntity],
      subscribers: [new MikroORMEventsSubscriber()],
    })
  )
  await orm.getSchemaGenerator().dropSchema()
  await orm.getSchemaGenerator().createSchema()
  await orm.getSchemaGenerator().refreshDatabase()
  await orm.getSchemaGenerator().clearDatabase()
})

afterEach(async () => {
  insertedEntitiesViaEvent = []
  await orm.close()
})

test('persistance works on event -> store', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
  })

  const persisted = await orm.em.fork().findOne(TestEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test')
})

test('persistance works on event -> store -> store.map', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
  })

  const persisted = await orm.em.fork().findOne(TestProjectionViaMapEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test projection')
})

test('no persistance for not changed entity', async () => {
  await orm.em.fork().persistAndFlush(new TestEntity({ id: 1, value: 'test' }))
  insertedEntitiesViaEvent = []

  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, await em().findOne(TestEntity, { id: 1 }))
  })

  assert.strictEqual(!!insertedEntitiesViaEvent.find(ent => ent instanceof TestEntity), false)
})

test('no persistance on error', async () => {
  await assert.rejects(async () => {
    await wrapEffectorMikroorm(orm, async () => {
      await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
      await sideEffect(makeError)
    })
  }, new Error('test-err'))

  assert.strictEqual(await orm.em.fork().findOne(TestEntity, { id: 1 }), null)
})
