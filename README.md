# effector-mikroorm

Use MikroORM Entities inside Effector Stores and achieve auto persistence in DB

## Knowledge requirements

Basic knowledge of [Effector](https://effector.dev/) and [MikroORM](https://mikro-orm.io/)

## Get started

Firstly, need to wrap each life cycle of your backend application (each HTTP request/response, handle MQ message, ...) with **effector-mikroorm**<br/>
Example of middleware for typical Koa application, where each HTTP request will be wrapped:

```ts
const orm = await MikroORM.init(
  defineConfig({
    /* DB config */
    entities: [/* init MikroORM Entities */]
  })
)

app.use(async (ctx, next) => {
  await wrapEffectorMikroorm(orm, async () => { return await next() });
})
```

Further, simply use Effector and MikroORM "as is" in code and auto persistence in DB will "magically" works 🪄 <br/>
Only need to use few utils like `em` and `sideEffect`, which can help to consider context of appropriate life cycle

## Example

```ts
import { Entity, PrimaryKey, Property, wrap } from '@mikro-orm/core'
import { createEffect, createEvent, createStore } from 'effector'
import { em, entityConstructor, onPersist, scope, sideEffect, wrapEffectorMikroorm } from 'effector-mikroorm'

@Entity()
class UserEntity {
  constructor(entity: Partial<UserEntity>) {
    // just little sugar, for avoiding boilerplate this.key = value
    entityConstructor(this, entity)
  }

  @PrimaryKey()
  id!: number

  @Property()
  name!: string

  // service property for deleting Entity, see below
  $forDelete?: boolean
}

const fetchUserFx = createEffect(async (id: number) => {
  // `em()` will return MikroORM Entity Manager for appropriate life cycle
  // need use `em()` everywhere, when you want to use MikroORM API
  return em().findOne(UserEntity, { id })
})
const createUser = createEvent<Partial<UserEntity>>()
const updateUser = createEvent<UserEntity>()
const deleteUser = createEvent<number>()

const $user = createStore<UserEntity | null>(null)

$user.on(fetchUserFx.doneData, (_, userFetched) => userFetched)
$user.on(createUser, (_, userPayload) => new UserEntity(userPayload))
$user.on(updateUser, (state, userPayload) => wrap(state).assign(userPayload))
$user.on(deleteUser, state => {
  // for deleting Entity, just assign `$forDelete` to it
  return wrap(state).assign({ $forDelete: true })
})

// `wrapEffectorMikroorm` here just for example
// Need to use `wrapEffectorMikroorm` as middleware of your framework, see example above
await wrapEffectorMikroorm(orm, async () => {
  // `sideEffect` is just little wrapper around Effector `allSettled`
  // it consider Effector Store mutation inside specific life cycle
  await sideEffect(createUser, { name: 'Vasya' })
  // Optional hook, which will be called after DB persist
  onPersist(async () => {
    // `scope` returns Effector Scope related to this life cycle
    scope().getState($user) // BTW, $user already contains `id`, because it's already persisted in DB
  })
})

// By the way, user Vasya already persisted in DB!

await wrapEffectorMikroorm(orm, async () => {
  await fetchUserFx(1)
  await sideEffect(updateUser, { id: 1, name: 'Petya' })
})

// user Vasya realized that he is Petya in DB now

await wrapEffectorMikroorm(orm, async () => {
  await fetchUserFx(1)
  await sideEffect(deleteUser, 1)
})

// user Petya go away from DB
```



