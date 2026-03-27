import type { FlowConfig } from './types.ts'

export class FlowRegistry {
  private flows = new Map<string, FlowConfig>()

  register(flow: FlowConfig): void {
    if (this.flows.has(flow.id)) {
      throw new Error(`Flow "${flow.id}" is already registered`)
    }
    this.flows.set(flow.id, flow)
  }

  unregister(flowId: string): void {
    if (flowId === 'log') {
      throw new Error('Cannot unregister the built-in log flow')
    }
    this.flows.delete(flowId)
  }

  get(flowId: string): FlowConfig | undefined {
    return this.flows.get(flowId)
  }

  getOrThrow(flowId: string): FlowConfig {
    const flow = this.flows.get(flowId)
    if (!flow) throw new Error(`Flow "${flowId}" not found`)
    return flow
  }

  list(): FlowConfig[] {
    return [...this.flows.values()]
  }

  has(flowId: string): boolean {
    return this.flows.has(flowId)
  }

  getAllFlowIds(): string[] {
    return [...this.flows.keys()]
  }
}
