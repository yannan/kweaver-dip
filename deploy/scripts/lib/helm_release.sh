#!/bin/bash
# shellcheck disable=SC2034,SC2154
#
# Common helpers for installing Helm releases from a release manifest.
# Shared by dip.sh / core.sh / isf.sh.
#
# Conventions:
#   - Output "var names" are passed as strings; functions use `eval` to assign
#     back to the caller's variable (keeps compatibility with older bash).
#   - Array appends use `eval` with escaped quotes.
#
# Relies on common.sh helpers:
#   - get_release_manifest_helm_repo_url
#   - get_release_manifest_image_registry
#   - apply_release_manifest_values
#   - should_skip_upgrade_same_chart_version
#   - get_repo_chart_latest_version
#   - ensure_helm_repo
#   - log_info / log_error / log_warn

# Resolve the Helm repo URL / repo name to use for a product install.
#
# Priority:
#   1. registry_override (CLI --registry): if set, replaces the registry host.
#   2. manifest source.helmRepoUrl
#   3. default_url (fallback, usually HELM_CHART_REPO_URL)
#
# Args:
#   $1 manifest_file       path or empty
#   $2 default_url         fallback url if manifest has none
#   $3 default_repo_name   fallback repo name for HTTP repos (e.g. "kweaver")
#   $4 registry_override   CLI --registry value or empty
#   $5 out_url_var         name of output var to set with final helm_repo_url
#   $6 out_name_var        name of output var to set with helm_repo_name_or_url
helm_release_resolve_repo() {
    local manifest_file="$1"
    local default_url="$2"
    local default_repo_name="$3"
    local registry_override="$4"
    local out_url_var="$5"
    local out_name_var="$6"

    local __hrr_manifest_url=""
    if [[ -n "${manifest_file}" && -f "${manifest_file}" ]]; then
        __hrr_manifest_url="$(get_release_manifest_helm_repo_url "${manifest_file}")"
    fi

    local __hrr_url="${__hrr_manifest_url:-${default_url}}"

    # Apply CLI --registry override
    if [[ -n "${registry_override}" ]]; then
        if [[ "${__hrr_url}" == oci://* ]]; then
            # Replace OCI registry host:  oci://<old>/charts  ->  oci://<new>/charts
            __hrr_url="oci://${registry_override}/charts"
        else
            # HTTP repo: treat override as full URL / registry base
            __hrr_url="${registry_override}"
        fi
    fi

    local __hrr_name="${__hrr_url}"
    if [[ "${__hrr_url}" != oci://* ]]; then
        __hrr_name="${default_repo_name:-kweaver}"
    fi

    eval "${out_url_var}=\"\${__hrr_url}\""
    eval "${out_name_var}=\"\${__hrr_name}\""
}

# Resolve the effective image registry for a release.
#
# Priority:
#   1. registry_override (CLI --registry)
#   2. manifest releases[<release_name>].imageRegistry (per-release override)
#   3. manifest source.imageRegistry
#   (empty if none set; caller should skip --set in that case)
#
# Args:
#   $1 manifest_file       path or empty
#   $2 product             (for per-release lookup; pass empty to skip)
#   $3 aggregate_version   (for per-release lookup)
#   $4 release_name        (for per-release lookup; pass empty to skip)
#   $5 registry_override   CLI --registry value or empty
# Prints: the resolved registry (may be empty)
helm_release_resolve_image_registry() {
    local manifest_file="$1"
    local product="$2"
    local aggregate_version="$3"
    local release_name="$4"
    local registry_override="$5"

    if [[ -n "${registry_override}" ]]; then
        echo "${registry_override}"
        return 0
    fi

    if [[ -z "${manifest_file}" || ! -f "${manifest_file}" ]]; then
        return 0
    fi

    # Try per-release override first
    if [[ -n "${product}" && -n "${release_name}" ]]; then
        local __rel_reg
        __rel_reg="$(get_release_manifest_release_image_registry \
                       "${manifest_file}" "${product}" "${aggregate_version}" "${release_name}" 2>/dev/null)"
        if [[ -n "${__rel_reg}" ]]; then
            echo "${__rel_reg}"
            return 0
        fi
    fi

    # Fall back to source.imageRegistry
    get_release_manifest_image_registry "${manifest_file}"
}

# Resolve the per-release helm repo name/URL to use for a single release.
#
# Priority:
#   1. manifest releases[<release_name>].helmRepoUrl (per-release override)
#   2. fallback_name_or_url (already resolved source/default from helm_release_resolve_repo)
#
# For HTTP per-release overrides, auto-registers a helm repo with a stable
# name derived from the URL. Sets out_var to either the OCI URL or the repo name.
#
# Args:
#   $1 manifest_file
#   $2 product
#   $3 aggregate_version
#   $4 release_name
#   $5 fallback_name_or_url     already resolved source/default value
#   $6 registry_override        CLI --registry value or empty
#   $7 out_var                  name of output variable
helm_release_resolve_per_release_repo() {
    local manifest_file="$1"
    local product="$2"
    local aggregate_version="$3"
    local release_name="$4"
    local fallback_name_or_url="$5"
    local registry_override="$6"
    local out_var="$7"

    local __prr_url=""
    if [[ -n "${manifest_file}" && -f "${manifest_file}" && -n "${product}" && -n "${release_name}" ]]; then
        __prr_url="$(get_release_manifest_release_helm_repo_url \
                       "${manifest_file}" "${product}" "${aggregate_version}" "${release_name}" 2>/dev/null)"
    fi

    if [[ -z "${__prr_url}" ]]; then
        eval "${out_var}=\"\${fallback_name_or_url}\""
        return 0
    fi

    # Apply CLI --registry override on top of per-release URL
    if [[ -n "${registry_override}" ]]; then
        if [[ "${__prr_url}" == oci://* ]]; then
            __prr_url="oci://${registry_override}/charts"
        else
            __prr_url="${registry_override}"
        fi
    fi

    if [[ "${__prr_url}" == oci://* ]]; then
        eval "${out_var}=\"\${__prr_url}\""
        return 0
    fi

    # HTTP: generate stable repo name from URL hash and register it
    local __prr_hash
    __prr_hash="$(printf '%s' "${__prr_url}" | sha1sum 2>/dev/null | cut -c1-8)"
    local __prr_name="kweaver-${__prr_hash}"
    ensure_helm_repo "${__prr_name}" "${__prr_url}"
    eval "${out_var}=\"\${__prr_name}\""
}

# Append `--set image.registry=<registry>` to the given helm-args array
# if a registry can be resolved.
#
# Args:
#   $1 target_array_name  (nameref) name of the helm_args array
#   $2 manifest_file
#   $3 product
#   $4 aggregate_version
#   $5 release_name
#   $6 registry_override  (CLI --registry value, or empty)
helm_release_append_image_registry_set() {
    local target_array_name="$1"
    local manifest_file="$2"
    local product="$3"
    local aggregate_version="$4"
    local release_name="$5"
    local registry_override="$6"

    local effective_registry
    effective_registry="$(helm_release_resolve_image_registry \
                            "${manifest_file}" "${product}" "${aggregate_version}" \
                            "${release_name}" "${registry_override}")"
    if [[ -n "${effective_registry}" ]]; then
        eval "${target_array_name}+=(\"--set\" \"image.registry=${effective_registry}\")"
    fi
}

# Build common helm "extra args" for a release:
#   - --set-string entries from manifest releases[<name>].values
#   - --set image.registry=... from CLI override or manifest source.imageRegistry
#
# Args:
#   $1 target_array_name   (nameref) helm_args array to append to
#   $2 manifest_file
#   $3 product             (e.g. "kweaver-dip", "kweaver-core", "isf")
#   $4 aggregate_version   (e.g. "0.6.0", "main")
#   $5 release_name        release name inside the manifest
#   $6 registry_override   CLI --registry value or empty
helm_release_build_extra_args() {
    local target_array_name="$1"
    local manifest_file="$2"
    local product="$3"
    local aggregate_version="$4"
    local release_name="$5"
    local registry_override="$6"

    if [[ -n "${manifest_file}" && -f "${manifest_file}" ]]; then
        apply_release_manifest_values \
            "${manifest_file}" \
            "${product}" \
            "${aggregate_version}" \
            "${release_name}" \
            "${target_array_name}" || return 1
    fi

    helm_release_append_image_registry_set \
        "${target_array_name}" \
        "${manifest_file}" \
        "${product}" \
        "${aggregate_version}" \
        "${release_name}" \
        "${registry_override}"
}

# Install a Helm release from a remote Helm repository or OCI registry.
#
# Args:
#   $1 release_name
#   $2 chart_name
#   $3 namespace
#   $4 helm_repo_name_or_url     e.g. "kweaver" or "oci://ghcr.io/kweaver-ai/charts"
#   $5 release_version           chart version (required for OCI; optional for HTTP)
#   $6 values_file               path to -f values file
#   $7 extra_args_array_name     (nameref) extra helm args already prepared by caller
#                                (e.g. from helm_release_build_extra_args)
helm_release_install_from_repo() {
    local release_name="$1"
    local chart_name="$2"
    local namespace="$3"
    local helm_repo_name_or_url="$4"
    local release_version="$5"
    local values_file="$6"
    local extra_args_array_name="$7"

    # Detect OCI
    local is_oci=false
    local chart_ref
    if [[ "${helm_repo_name_or_url}" == oci://* ]]; then
        is_oci=true
        chart_ref="${helm_repo_name_or_url}/${chart_name}"
    else
        chart_ref="${helm_repo_name_or_url}/${chart_name}"
    fi

    local target_version="${release_version}"
    if [[ -z "${target_version}" ]]; then
        if [[ "${is_oci}" == "true" ]]; then
            log_error "OCI charts require explicit version. Please provide version in manifest"
            return 1
        fi
        target_version=$(get_repo_chart_latest_version "${helm_repo_name_or_url}" "${chart_name}")
    fi

    if should_skip_upgrade_same_chart_version "${release_name}" "${namespace}" "${chart_name}" "${target_version}"; then
        return 0
    fi

    # Clean up any pending/failed state before installing
    local current_status
    current_status=$(helm status "${release_name}" -n "${namespace}" -o json 2>/dev/null \
        | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [[ -n "${current_status}" && "${current_status}" != "deployed" && "${current_status}" != "failed" ]]; then
        log_info "Cleaning up ${release_name} (status: ${current_status})..."
        helm uninstall "${release_name}" -n "${namespace}" 2>/dev/null || true
    fi

    log_info "Installing ${release_name} from ${chart_ref}..."

    local -a helm_args=(
        "upgrade" "--install" "${release_name}"
        "${chart_ref}"
        "--namespace" "${namespace}"
        "-f" "${values_file}"
    )
    if [[ -n "${release_version}" ]]; then
        helm_args+=("--version" "${release_version}")
    fi
    helm_args+=("--devel" "--wait" "--timeout=600s")

    # Append caller-provided extra args (e.g. --set image.registry=..., --set-string k=v)
    if [[ -n "${extra_args_array_name}" ]]; then
        local -a extra_copy=()
        eval "extra_copy=(\"\${${extra_args_array_name}[@]}\")"
        helm_args+=("${extra_copy[@]}")
    fi

    if helm "${helm_args[@]}"; then
        log_info "✓ ${release_name} installed successfully"
    else
        log_error "✗ Failed to install ${release_name}"
        return 1
    fi
}

# Install a Helm release from a local chart .tgz file.
#
# Args:
#   $1 release_name
#   $2 chart_tgz                absolute path to the .tgz chart
#   $3 namespace
#   $4 values_file              path to -f values file
#   $5 extra_args_array_name    (nameref) extra helm args already prepared by caller
helm_release_install_from_local() {
    local release_name="$1"
    local chart_tgz="$2"
    local namespace="$3"
    local values_file="$4"
    local extra_args_array_name="$5"

    log_info "Installing ${release_name} from local chart: $(basename "${chart_tgz}")..."

    local -a helm_args=(
        "upgrade" "--install" "${release_name}" "${chart_tgz}"
        "--namespace" "${namespace}"
        "-f" "${values_file}"
        "--wait" "--timeout=600s"
    )

    if [[ -n "${extra_args_array_name}" ]]; then
        local -a extra_copy=()
        eval "extra_copy=(\"\${${extra_args_array_name}[@]}\")"
        helm_args+=("${extra_copy[@]}")
    fi

    if helm "${helm_args[@]}"; then
        log_info "✓ ${release_name} installed successfully"
    else
        log_error "✗ Failed to install ${release_name}"
        return 1
    fi
}
