import { EntityManager, MikroORM } from '@mikro-orm/core'
import { Effect, EffectParams, EffectResult, Scope, Unit, is } from 'effector'
import { fork, serialize, allSettled } from 'effector'
import { diDep, diInit, diSet } from 'ts-fp-di'

const EFFECTOR_MIKROORM_DOMAIN = 'effector-mikroorm-domain'
const EFFECTOR_MIKROORM_EM = 'effector-mikroorm-em'

export const wrapEffectorMikroorm = async (orm: MikroORM, cb: () => Promise<void>) => {
  await diInit(async () => {
    const domain = fork()
    const em = orm.em.fork()

    diSet(EFFECTOR_MIKROORM_DOMAIN, domain)
    diSet(EFFECTOR_MIKROORM_EM, em)

    await cb()

    persistIfEntity(Object.values(serialize(domain, { onlyChanges: true })))

    await em.flush()
  })
}

export function sideEffect<FX extends Effect<any, any, any>>(
  unit: FX,
  config?: { params: EffectParams<FX> }
): Promise<EffectResult<FX>>

export function sideEffect<T>(unit: Unit<T>, config?: { params: T }): Promise<unknown>

export async function sideEffect(unit: any, config?: any) {
  const resp = await allSettled(unit, {
    ...config,
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
    maybeEntity &&
    em.config.get('entities').find(EntityClass => EntityClass instanceof Function && maybeEntity instanceof EntityClass)
  ) {
    em.persist(maybeEntity)
  }
}
