export interface TunableParamDefinition {
    name: string;
    default: number;
    min: number;
    max: number;
    step: number;
}

export class TunableParamRegistry {
    private definitions = new Map<string, TunableParamDefinition[]>();
    private values = new Map<string, Map<string, number>>();

    register(domainId: string, params: TunableParamDefinition[]): void {
        this.definitions.set(domainId, params);
        const valueMap = new Map<string, number>();
        for (const param of params) {
            valueMap.set(param.name, param.default);
        }
        this.values.set(domainId, valueMap);
    }

    get(domainId: string, paramName: string): number | undefined {
        return this.values.get(domainId)?.get(paramName);
    }

    getAllForDomain(domainId: string): Record<string, number> {
        const valueMap = this.values.get(domainId);
        if (!valueMap) return {};
        const result: Record<string, number> = {};
        for (const [key, value] of valueMap) {
            result[key] = value;
        }
        return result;
    }

    getDefinitions(domainId: string): TunableParamDefinition[] {
        return this.definitions.get(domainId) ?? [];
    }

    applyOverrides(domainId: string, overrides: Record<string, number>): void {
        const defs = this.definitions.get(domainId);
        const valueMap = this.values.get(domainId);
        if (!defs || !valueMap) return;

        for (const [name, value] of Object.entries(overrides)) {
            const def = defs.find((d) => d.name === name);
            if (!def) continue;
            const clamped = Math.max(def.min, Math.min(def.max, value));
            valueMap.set(name, clamped);
        }
    }

    getDomainIds(): string[] {
        return [...this.definitions.keys()];
    }
}
