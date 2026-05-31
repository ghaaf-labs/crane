import { auditActions, auditResourceTypes } from "@crane/server/db/schema";
import { format } from "date-fns";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	FileClock,
	Loader2,
	Search,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const PAGE_SIZE = 50;
const ANY = "__any__";

type Action = (typeof auditActions)[number];

const actionBadgeVariant = (
	action: string,
): "default" | "secondary" | "red" => {
	if (action === "delete") return "red";
	if (action === "create" || action === "deploy" || action === "redeploy")
		return "default";
	return "secondary";
};

const prettyMetadata = (metadata: string | null): string | null => {
	if (!metadata) return null;
	try {
		return JSON.stringify(JSON.parse(metadata), null, 2);
	} catch {
		return metadata;
	}
};

export const ShowAuditLogs = () => {
	const [userEmail, setUserEmail] = useState("");
	const [resourceName, setResourceName] = useState("");
	const [action, setAction] = useState<string>(ANY);
	const [resourceType, setResourceType] = useState<string>(ANY);
	const [page, setPage] = useState(0);

	const filters = {
		userEmail: userEmail.trim() || undefined,
		resourceName: resourceName.trim() || undefined,
		action: action === ANY ? undefined : (action as Action),
		resourceType:
			resourceType === ANY
				? undefined
				: (resourceType as (typeof auditResourceTypes)[number]),
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	};

	const { data, isPending, isFetching } = api.auditLog.all.useQuery(filters);
	const utils = api.useUtils();
	const [isExporting, setIsExporting] = useState(false);

	// Export respects the active filters (not pagination); server caps the rows.
	const exportFilters = {
		userEmail: userEmail.trim() || undefined,
		resourceName: resourceName.trim() || undefined,
		action: action === ANY ? undefined : (action as Action),
		resourceType:
			resourceType === ANY
				? undefined
				: (resourceType as (typeof auditResourceTypes)[number]),
	};

	const handleExport = async () => {
		setIsExporting(true);
		try {
			const result = await utils.auditLog.export.fetch(exportFilters);
			const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
			toast.success(
				result.truncated
					? `Exported ${result.rowCount} of ${result.total} entries (capped)`
					: `Exported ${result.rowCount} entries`,
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Export failed");
		} finally {
			setIsExporting(false);
		}
	};

	const logs = data?.logs ?? [];
	const total = data?.total ?? 0;
	const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
	const end = Math.min((page + 1) * PAGE_SIZE, total);
	const hasFilters =
		userEmail !== "" ||
		resourceName !== "" ||
		action !== ANY ||
		resourceType !== ANY;

	const resetPageAnd =
		<T,>(setter: (v: T) => void) =>
		(value: T) => {
			setter(value);
			setPage(0);
		};

	const clearFilters = () => {
		setUserEmail("");
		setResourceName("");
		setAction(ANY);
		setResourceType(ANY);
		setPage(0);
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-7xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-row items-start justify-between gap-4">
						<div className="space-y-1.5">
							<CardTitle className="text-xl flex flex-row gap-2">
								<FileClock className="size-6 text-muted-foreground self-center" />
								Audit Logs
							</CardTitle>
							<CardDescription>
								A read-only trail of who did what across this organization —
								deployments, resource changes, and sign-ins.
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="gap-1 shrink-0"
							onClick={handleExport}
							disabled={isExporting || total === 0}
						>
							{isExporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Download className="size-4" />
							)}
							Export CSV
						</Button>
					</CardHeader>
					<CardContent className="space-y-4 py-6 border-t">
						<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
							<div className="flex flex-col gap-1">
								<span className="text-xs text-muted-foreground">
									User email
								</span>
								<div className="relative">
									<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
									<Input
										placeholder="user@example.com"
										className="pl-8 w-[220px]"
										value={userEmail}
										onChange={(e) => resetPageAnd(setUserEmail)(e.target.value)}
									/>
								</div>
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-xs text-muted-foreground">
									Resource name
								</span>
								<Input
									placeholder="my-app"
									className="w-[180px]"
									value={resourceName}
									onChange={(e) =>
										resetPageAnd(setResourceName)(e.target.value)
									}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-xs text-muted-foreground">Action</span>
								<Select value={action} onValueChange={resetPageAnd(setAction)}>
									<SelectTrigger className="w-[150px]">
										<SelectValue placeholder="Any action" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ANY}>Any action</SelectItem>
										{auditActions.map((a) => (
											<SelectItem key={a} value={a}>
												{a}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-xs text-muted-foreground">
									Resource type
								</span>
								<Select
									value={resourceType}
									onValueChange={resetPageAnd(setResourceType)}
								>
									<SelectTrigger className="w-[170px]">
										<SelectValue placeholder="Any resource" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ANY}>Any resource</SelectItem>
										{auditResourceTypes.map((r) => (
											<SelectItem key={r} value={r}>
												{r}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							{hasFilters && (
								<Button
									variant="outline"
									size="sm"
									onClick={clearFilters}
									className="gap-1"
								>
									<X className="size-4" />
									Clear
								</Button>
							)}
						</div>

						{isPending ? (
							<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[35vh]">
								<span>Loading...</span>
								<Loader2 className="animate-spin size-4" />
							</div>
						) : logs.length === 0 ? (
							<div className="flex flex-col items-center gap-3 min-h-[35vh] justify-center">
								<FileClock className="size-8 self-center text-muted-foreground" />
								<span className="text-base text-muted-foreground">
									{hasFilters
										? "No audit entries match these filters"
										: "No audit entries recorded yet"}
								</span>
							</div>
						) : (
							<div className="flex flex-col gap-4">
								<div
									className={
										isFetching ? "opacity-60 transition-opacity" : undefined
									}
								>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead className="w-[190px]">Time</TableHead>
												<TableHead>User</TableHead>
												<TableHead className="text-center">Action</TableHead>
												<TableHead>Resource</TableHead>
												<TableHead className="text-right">Details</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{logs.map((log) => {
												const metadata = prettyMetadata(log.metadata);
												return (
													<TableRow key={log.id}>
														<TableCell className="text-sm text-muted-foreground whitespace-nowrap">
															{format(new Date(log.createdAt), "PPpp")}
														</TableCell>
														<TableCell>
															<div className="flex flex-col">
																<span className="text-sm">{log.userEmail}</span>
																<span className="text-xs text-muted-foreground">
																	{log.userRole}
																</span>
															</div>
														</TableCell>
														<TableCell className="text-center">
															<Badge variant={actionBadgeVariant(log.action)}>
																{log.action}
															</Badge>
														</TableCell>
														<TableCell>
															<div className="flex flex-col">
																<span className="text-sm">
																	{log.resourceName ?? (
																		<span className="text-muted-foreground">
																			—
																		</span>
																	)}
																</span>
																<span className="text-xs text-muted-foreground">
																	{log.resourceType}
																</span>
															</div>
														</TableCell>
														<TableCell className="text-right">
															{metadata ? (
																<Popover>
																	<PopoverTrigger asChild>
																		<Button
																			variant="ghost"
																			size="sm"
																			className="h-7"
																		>
																			View
																		</Button>
																	</PopoverTrigger>
																	<PopoverContent
																		align="end"
																		className="w-[420px] max-h-[400px] overflow-auto"
																	>
																		<pre className="text-xs whitespace-pre-wrap break-words">
																			{metadata}
																		</pre>
																	</PopoverContent>
																</Popover>
															) : (
																<span className="text-muted-foreground text-sm">
																	—
																</span>
															)}
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>
								</div>

								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">
										{start}–{end} of {total}
									</span>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											className="gap-1"
											disabled={page === 0 || isFetching}
											onClick={() => setPage((p) => Math.max(0, p - 1))}
										>
											<ChevronLeft className="size-4" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="gap-1"
											disabled={end >= total || isFetching}
											onClick={() => setPage((p) => p + 1)}
										>
											Next
											<ChevronRight className="size-4" />
										</Button>
									</div>
								</div>
							</div>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
