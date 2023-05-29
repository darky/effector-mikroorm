import { EntityManager, MikroORM } from '@mikro-orm/core'
import { Effect, EffectParams, EffectResult, Scope, Unit, is } from 'effector'
import { fork, allSettled } from 'effector'
import { inspect } from 'effector/inspect'
import { diDep, diHas, diInit, diSet } from 'ts-fp-di'

const EFFECTOR_MIKROORM_SCOPE = 'effector-mikroorm-scope'
const EFFECTOR_MIKROORM_EM = 'effector-mikroorm-em'
const EFFECTOR_MIKROORM_ENTITIES = 'effector-mikroorm-entities'
const EFFECTOR_MIKROORM_ON_PERSIST_CB = 'effector-mikroorm-on-persist-cb'

type ScopeReg = {
  [key: string]: {
    current: unknown
    meta?: {
      op: 'store' | 'other'
    }
  }
}

export const wrapEffectorMikroorm = async <T>(orm: MikroORM, cb: () => Promise<T>): Promise<T> => {
  return await diInit(async () => {
    const scope = diHas(EFFECTOR_MIKROORM_SCOPE) ? diDep<Scope>(EFFECTOR_MIKROORM_SCOPE) : fork()
    let error!: Error

    inspect({
      scope,
      fn: m => {
        m.type === 'error' && (error = m.error as Error)
      },
    })

    const em = orm.em.fork()

    diSet(EFFECTOR_MIKROORM_SCOPE, scope)
    diSet(EFFECTOR_MIKROORM_EM, em)
    diSet(EFFECTOR_MIKROORM_ENTITIES, new Set(orm.config.get('entities')))

    const resp = await cb()

    if (error) {
      throw error
    }

    persistIfEntity(
      Object.values((scope as unknown as { reg: ScopeReg }).reg)
        .filter(val => val.meta?.op === 'store')
        .map(val => val.current)
    )

    await em.flush()

    if (diHas(EFFECTOR_MIKROORM_ON_PERSIST_CB)) {
      await diDep<() => Promise<void>>(EFFECTOR_MIKROORM_ON_PERSIST_CB)()
    }

    return resp
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
    scope: diDep<Scope>(EFFECTOR_MIKROORM_SCOPE),
  })
  if (!is.effect(unit)) {
    return
  }
  if (resp.status === 'fail') {
    throw resp.value
  }
  return resp.value
}

export const em = () => diDep<EntityManager>(EFFECTOR_MIKROORM_EM)

export const scope = () => diDep<Scope>(EFFECTOR_MIKROORM_SCOPE)

export const onPersist = (cb: () => Promise<void>) => {
  diSet(EFFECTOR_MIKROORM_ON_PERSIST_CB, cb)
}

export const entityConstructor = <T extends object>(self: T, ent: T) =>
  Object.entries(ent).forEach(([key, val]) => Reflect.set(self, key, val))

const persistIfEntity = (maybeEntity: unknown) => {
  if (Array.isArray(maybeEntity)) {
    return maybeEntity.forEach(persistIfEntity)
  }
  if (!isEntity(maybeEntity)) {
    return
  }
  if (maybeEntity.$forDelete) {
    diDep<EntityManager>(EFFECTOR_MIKROORM_EM).remove(maybeEntity)
  } else {
    diDep<EntityManager>(EFFECTOR_MIKROORM_EM).persist(maybeEntity)
  }
}

const isEntity = (maybeEntity: unknown): maybeEntity is { $forDelete?: boolean; [key: string]: unknown } =>
  diDep<Set<unknown>>(EFFECTOR_MIKROORM_ENTITIES).has(
    (Object.getPrototypeOf(maybeEntity ?? {}) as { constructor: unknown }).constructor
  )
