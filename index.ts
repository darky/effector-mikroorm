import { EntityManager, MikroORM } from '@mikro-orm/core'
import { Effect, EffectParams, EffectResult, Scope, Unit, is } from 'effector'
import { fork, allSettled } from 'effector'
import { inspect } from 'effector/inspect'
import { diDep, diInit, diSet } from 'ts-fp-di'

const EFFECTOR_MIKROORM_DOMAIN = 'effector-mikroorm-domain'
const EFFECTOR_MIKROORM_EM = 'effector-mikroorm-em'
const EFFECTOR_MIKROORM_ENTITIES = 'effector-mikroorm-entities'

type ScopeReg = {
  [key: string]: {
    current: unknown
    meta?: {
      op: 'store' | 'other'
    }
  }
}

export const wrapEffectorMikroorm = async (orm: MikroORM, cb: () => Promise<void>) => {
  await diInit(async () => {
    const domain = fork()
    let error!: Error

    inspect({
      scope: domain,
      fn: m => {
        m.type === 'error' && (error = m.error as Error)
      },
    })

    const em = orm.em.fork()

    diSet(EFFECTOR_MIKROORM_DOMAIN, domain)
    diSet(EFFECTOR_MIKROORM_EM, em)
    diSet(EFFECTOR_MIKROORM_ENTITIES, new Set(orm.config.get('entities')))

    await cb()

    if (error) {
      throw error
    }

    persistIfEntity(
      Object.values((domain as unknown as { reg: ScopeReg }).reg)
        .filter(val => val.meta?.op === 'store')
        .map(val => val.current)
    )

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

export const entityConstructor = <T extends object>(self: T, ent: T) =>
  Object.entries(ent).forEach(([key, val]) => Reflect.set(self, key, val))

const persistIfEntity = (maybeEntity: unknown) => {
  if (Array.isArray(maybeEntity)) {
    return maybeEntity.forEach(persistIfEntity)
  }

  const em = diDep<EntityManager>(EFFECTOR_MIKROORM_EM)

  if (
    diDep<Set<unknown>>(EFFECTOR_MIKROORM_ENTITIES).has(
      (Object.getPrototypeOf(maybeEntity ?? {}) as { constructor: unknown }).constructor
    )
  ) {
    em.persist(maybeEntity as object)
  }
}
