// YuanQi package entry point: implemented Cordis host integration and domain capabilities only.
export {
  createSubjectStore,
  createWorldlineStore,
  SELF_MODEL_CENTER_IDS,
  openSubjectDomains,
  userSubjectDomainSpec,
  yuanqiSubjectDomainSpec,
} from './src/domain/index.js';
export { name, inject, apply } from './src/dsh/plugin.js';
