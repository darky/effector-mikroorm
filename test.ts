import { Entity, EventArgs, EventSubscriber, MikroORM, PrimaryKey, Property } from '@mikro-orm/core'
import { defineConfig } from '@mikro-orm/better-sqlite'
import test, { afterEach, beforeEach } from 'node:test'
import { combine, createEffect, createEvent, createStore } from 'effector'
import { em, sideEffect, wrapEffectorMikroorm } from './index'
import assert from 'node:assert'

let orm: MikroORM
let insertedEntitiesViaEvent: unknown[] = []

@Entity()
class TestEntity {
  constructor(ent: Partial<TestEntity>) {
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

@Entity()
class TestProjectionViaCombineEntity {
  constructor(ent: TestProjectionViaCombineEntity) {
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

const createTestEntityFx = createEffect(async () => {
  return new TestEntity({ id: 1, value: 'test' })
})
const createTestEntity = createEvent<TestEntity>()
const makeError = createEvent()
const makeErrorFx = createEffect(async () => {
  throw new Error('test-err')
})

const $storeMultiple = createStore<TestEntity[]>([])
$storeMultiple.on(createTestEntity, (s, ent) => [...s, ent])

const $store = createStore<TestEntity | null>(null, { sid: '$store' })
$store.on(createTestEntity, (_, entity) => entity)
$store.on(createTestEntityFx.doneData, (_, entity) => entity)

const $storeMap = $store.map(ent =>
  ent ? new TestProjectionViaMapEntity({ ...ent, value: `${ent.value} projection` }) : ent
)

const $error = createStore(null)
$error.on(makeError, () => {
  throw new Error('test-err')
})

combine([$store, $storeMap], ([$s, $sm]) =>
  $s && $sm ? new TestProjectionViaCombineEntity({ id: 1, value: `${$s.value} | ${$sm.value}` }) : null
)

beforeEach(async () => {
  orm = await MikroORM.init(
    defineConfig({
      // dbName: 'test.sqlite',
      dbName: ':memory:',
      debug: true,
      entities: [TestEntity, TestProjectionViaMapEntity, TestProjectionViaCombineEntity],
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

test('persistance works for event -> store', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
  })

  const persisted = await orm.em.fork().findOne(TestEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test')
})

test('persistance works for event -> store (multiple entities)', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ value: 'test' }))
    await sideEffect(createTestEntity, new TestEntity({ value: 'test2' }))
  })

  const persisted = await orm.em.fork().find(TestEntity, { $or: [{ id: 1 }, { id: 2 }] }, { orderBy: { id: 'ASC' } })
  assert.strictEqual(persisted[0]?.id, 1)
  assert.strictEqual(persisted[0]?.value, 'test')
  assert.strictEqual(persisted[1]?.id, 2)
  assert.strictEqual(persisted[1]?.value, 'test2')
})

test('persistance works for fx -> store', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntityFx)
  })

  const persisted = await orm.em.fork().findOne(TestEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test')
})

test('persistance works for event -> store -> store.map', async () => {
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

test('no persistance on store error', async () => {
  await assert.rejects(async () => {
    await wrapEffectorMikroorm(orm, async () => {
      await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
      await sideEffect(makeError)
    })
  }, new Error('test-err'))

  assert.strictEqual(await orm.em.fork().findOne(TestEntity, { id: 1 }), null)
})

test('no persistance on fx error', async () => {
  await assert.rejects(async () => {
    await wrapEffectorMikroorm(orm, async () => {
      await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
      await sideEffect(makeErrorFx)
    })
  }, new Error('test-err'))

  assert.strictEqual(await orm.em.fork().findOne(TestEntity, { id: 1 }), null)
})

test('persistance works for event -> store -> combine', async () => {
  await wrapEffectorMikroorm(orm, async () => {
    await sideEffect(createTestEntity, new TestEntity({ id: 1, value: 'test' }))
  })

  const persisted = await orm.em.fork().findOne(TestProjectionViaCombineEntity, { id: 1 })
  assert.strictEqual(persisted?.id, 1)
  assert.strictEqual(persisted?.value, 'test | test projection')
})
