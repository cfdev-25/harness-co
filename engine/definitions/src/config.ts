/** 02 §4.1. Nothing here has a default that weakens a rule: the quota's is the
    one the table gives, and every other value must be supplied. */
export interface Config {
	root: string;
	hooks: string;
	sock: string;
	listen: string;
	apiUrl: string;
	serviceToken: string;
	quota: number;
}

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set (02 §4.1)`);
	return value;
};

export function configFromEnv(): Config {
	return {
		root: required("DEFINITIONS_ROOT"),
		hooks: required("DEFINITIONS_HOOKS"),
		sock: required("DEFINITIONS_SOCK"),
		listen: required("DEFINITIONS_LISTEN"),
		apiUrl: required("API_URL"),
		serviceToken: required("HARNESS_SERVICE_TOKEN"),
		quota: Number(process.env.DEFINITIONS_QUOTA_BYTES ?? 2 * 1024 ** 3),
	};
}
