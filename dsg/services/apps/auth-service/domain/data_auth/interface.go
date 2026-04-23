package data_auth

import (
	"context"

	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/dto"
)

type UseCase interface {
	DataResourceAuth(ctx context.Context, req *dto.DataResourceAuthReqArg) error
	// GetDataResourceAuthStatus 查询某个数据资源授权申请的审核状态（返回缓存中的审核详情）。
	// resourceID: 数据资源（视图）ID
	GetDataResourceAuthStatus(ctx context.Context, resourceID string) (*dto.DataViewAuthAuditDetail, error)
}
