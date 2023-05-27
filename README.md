# effector-mikroorm

Use MikroORM Entities inside Effector Stores and achieve auto persistance in DB

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

Further, simply use Effector and MikroORM "as is" in code and auto persistance in DB will "magically" works 🪄 <br/>
Only need to use few utils like `em` and `sideEffect`, which can help to consider context of appropriate life cycle

## Example

```ts
import { Entity, PrimaryKey, Property, wrap } from '@mikro-orm/core'
import { createEffect, createEvent, createStore } from 'effector'
import { em, entityConstructor, sideEffect, wrapEffectorMikroorm } from 'effector-mikroorm'

@Entity()
class UserEntity {
  constructor(entity: Partial<UserEntity>) {
    entityConstructor(this, entity)
  }

  @PrimaryKey()
  id!: number

  @Property()
  name!: string

  $forDelete?: boolean
}

const fetchUserFx = createEffect(async (id: number) => em().findOne(UserEntity, { id }))
const createUser = createEvent<UserEntity>()
const updateUser = createEvent<UserEntity>()
const deleteUser = createEvent<number>()

const $user = createStore<UserEntity | null>(null)

$user.on(fetchUserFx.doneData, (_, userFetched) => userFetched)
$user.on(createUser, (_, userPayload) => new UserEntity(userPayload))
$user.on(updateUser, (state, userPayload) => wrap(state).assign(userPayload))
$user.on(deleteUser, state => wrap(state).assign({ $forDelete: true }))

await wrapEffectorMikroorm(orm, async () => {
  await sideEffect(createUser, { id: 1, name: 'Vasya' })
})

await wrapEffectorMikroorm(orm, async () => {
  await fetchUserFx(1)
  await sideEffect(updateUser, { id: 1, name: 'Petya' })
})

await wrapEffectorMikroorm(orm, async () => {
  await fetchUserFx(1)
  await sideEffect(deleteUser, 1)
})
```
