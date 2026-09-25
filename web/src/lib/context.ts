import { createContext, useContext } from 'react';
import type { Deployment } from './deployment';

export const DeploymentContext = createContext<Deployment | null>(null);

export function useDeployment(): Deployment {
  const value = useContext(DeploymentContext);
  if (!value) throw new Error('useDeployment must be used inside DeploymentContext');
  return value;
}
