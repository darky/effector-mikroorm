import { EntityManager, MikroORM } from '@mikro-orm/core'
import { Effect, EffectParams, EffectResult, Scope, Unit, is } from 'effector'
import { fork, serialize, allSettled } from 'effector'
import { diDep, diInit, diSet } from 'ts-fp-di'

const EFFECTOR_MIKROORM_DOMAIN = 'effector-mikroorm-domain'
const EFFECTOR_MIKROORM_EM = 'effector-mikroorm-em'
const EFFECTOR_MIKROORM_ENTITIES = 'effector-mikroorm-entities'

export const wrapEffectorMikroorm = async (orm: MikroORM, cb: () => Promise<void>) => {
  await diInit(async () => {
    const domain = fork()
    const em = orm.em.fork()

    diSet(EFFECTOR_MIKROORM_DOMAIN, domain)
    diSet(EFFECTOR_MIKROORM_EM, em)
    diSet(EFFECTOR_MIKROORM_ENTITIES, new Set(orm.config.get('entities')))

    await cb()

    persistIfEntity(Object.values(serialize(domain, { onlyChanges: true })))

    await em.flush()
  })
}

export function sideEffect<FX extends Effect<any, any, any>>(
  unit: FX,
  params?: EffectParams<FX>
): Promise<EffectResult<FX>>

export function sideEffect<T>(unit: Unit<T>, params?: T): Promise<unknown>

export async function sideEffect(unit: any, params?: any) {
  const resp = await allSettled(unit, {
    params,
    scope: diDep<Scope>(EFFECTOR_MIKROORM_DOMAIN),
  })

  if (is.effect(unit)) {
    if (resp.status === 'fail') {
      throw resp.value
    }

    return resp.value
  }

  return resp
}

export const em = () => diDep<EntityManager>(EFFECTOR_MIKROORM_EM)

const persistIfEntity = (maybeEntity: unknown) => {
  if (Array.isArray(maybeEntity)) {
    return maybeEntity.forEach(persistIfEntity)
  }

  const em = diDep<EntityManager>(EFFECTOR_MIKROORM_EM)

  if (
    diDep<Set<unknown>>(EFFECTOR_MIKROORM_ENTITIES).has(
      (Object.getPrototypeOf(maybeEntity) as { constructor: unknown }).constructor
    )
  ) {
    em.persist(maybeEntity as object)
  }
}
