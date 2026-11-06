// YuanQi package entry point.
// Only capabilities present in the current source tree are exported here.
// DSH host lifecycle integration and the historical birth-calculation modules
// are intentionally not re-exported until their implementations are rebuilt
// and validated on this branch.
export {
  createSubjectStore,
  openSubjectDomains,
  userSubjectDomainSpec,
  yuanqiSubjectDomainSpec,
} from './src/domain/index.js';
