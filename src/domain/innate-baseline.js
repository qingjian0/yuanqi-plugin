const STEMS = {
  '甲': { element: 'wood', polarity: 'yang' }, '乙': { element: 'wood', polarity: 'yin' },
  '丙': { element: 'fire', polarity: 'yang' }, '丁': { element: 'fire', polarity: 'yin' },
  '戊': { element: 'earth', polarity: 'yang' }, '己': { element: 'earth', polarity: 'yin' },
  '庚': { element: 'metal', polarity: 'yang' }, '辛': { element: 'metal', polarity: 'yin' },
  '壬': { element: 'water', polarity: 'yang' }, '癸': { element: 'water', polarity: 'yin' },
};
const HIDDEN_STEMS = {
  '子': ['癸'], '丑': ['癸', '辛', '己'], '寅': ['甲', '丙', '戊'],
  '卯': ['乙'], '辰': ['乙', '戊', '癸'], '巳': ['庚', '丙', '戊'],
  '午': ['丁', '己'], '未': ['乙', '己', '丁'], '申': ['庚', '壬', '戊'],
  '酉': ['辛'], '戌': ['辛', '丁', '戊'], '亥': ['壬', '甲'],
};
const GENERATES = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const CONTROLS = { wood: 'earth', fire: 'metal', earth: 'water', metal: 'wood', water: 'fire' };
const ELEMENTS = ['wood', 'fire', 'earth', 'metal', 'water'];
const PILLARS = ['year', 'month', 'day', 'hour'];
const ALGORITHM_VERSION = 'yuanqi-innate-bazi-structure-v1';

function tenGod(dayMaster, other) {
  const samePolarity = dayMaster.polarity === other.polarity;
  if (dayMaster.element === other.element) return samePolarity ? '比肩' : '劫财';
  if (GENERATES[dayMaster.element] === other.element) return samePolarity ? '食神' : '伤官';
  if (CONTROLS[dayMaster.element] === other.element) return samePolarity ? '偏财' : '正财';
  if (CONTROLS[other.element] === dayMaster.element) return samePolarity ? '七杀' : '正官';
  if (GENERATES[other.element] === dayMaster.element) return samePolarity ? '偏印' : '正印';
  throw new Error('unsupported five-element relationship');
}

function emptyBaseline(status, sourceProfileId, sourceWakeEventRef, sourceBaziVersion) {
  return {
    status,
    algorithm_version: ALGORITHM_VERSION,
    source_birth_profile_id: sourceProfileId,
    source_wake_event_ref: sourceWakeEventRef,
    source_bazi_algorithm_version: sourceBaziVersion,
    day_master: null,
    components: null,
    element_counts: null,
    interpretation_status: 'not_interpreted',
  };
}

/**
 * Build a source-traceable symbolic structure from YuanQi's calculated Bazi.
 * This is not a personality diagnosis, strength score, or SelfModel.
 */
export function deriveInnateBaseline({
  bazi,
  source_birth_profile_id,
  source_wake_event_ref,
} = {}) {
  if (!bazi || bazi.status !== 'calculated' || !bazi.pillars) {
    const status = bazi?.status === 'ambiguous' ? 'ambiguous'
      : bazi?.status === 'unavailable' ? 'unavailable' : 'pending';
    return emptyBaseline(status, source_birth_profile_id, source_wake_event_ref,
      bazi?.algorithm_version ?? null);
  }
  for (const pillar of PILLARS) {
    const value = bazi.pillars[pillar];
    if (typeof value !== 'string' || value.length !== 2 ||
        !STEMS[value[0]] || !HIDDEN_STEMS[value[1]]) {
      return emptyBaseline('unavailable', source_birth_profile_id,
        source_wake_event_ref, bazi.algorithm_version);
    }
  }

  const dayMasterStem = bazi.pillars.day[0];
  const dayMaster = { stem: dayMasterStem, ...STEMS[dayMasterStem] };
  const components = [];
  const elementCounts = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };

  for (const pillar of PILLARS) {
    const value = bazi.pillars[pillar];
    const visibleStem = value[0];
    const visibleAttributes = STEMS[visibleStem];
    components.push({
      pillar, source: 'visible_stem', order: 0, stem: visibleStem,
      element: visibleAttributes.element, polarity: visibleAttributes.polarity,
      ten_god: pillar === 'day' ? '日主' : tenGod(dayMaster, visibleAttributes),
    });
    elementCounts[visibleAttributes.element] += 1;

    for (const [order, hiddenStem] of HIDDEN_STEMS[value[1]].entries()) {
      const hiddenAttributes = STEMS[hiddenStem];
      components.push({
        pillar, source: 'hidden_stem', order, stem: hiddenStem,
        element: hiddenAttributes.element, polarity: hiddenAttributes.polarity,
        ten_god: tenGod(dayMaster, hiddenAttributes),
      });
      elementCounts[hiddenAttributes.element] += 1;
    }
  }

  return {
    status: 'ready',
    algorithm_version: ALGORITHM_VERSION,
    source_birth_profile_id: source_birth_profile_id ?? null,
    source_wake_event_ref: source_wake_event_ref ?? null,
    source_bazi_algorithm_version: bazi.algorithm_version,
    day_master: dayMaster,
    components,
    element_counts: elementCounts,
    interpretation_status: 'not_interpreted',
  };
}

export const BAZI_HIDDEN_STEMS = Object.freeze(
  Object.fromEntries(Object.entries(HIDDEN_STEMS).map(([branch, stems]) =>
    [branch, Object.freeze([...stems])])),
);
