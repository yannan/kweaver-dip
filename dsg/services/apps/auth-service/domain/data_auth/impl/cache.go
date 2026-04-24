package impl

import (
	"context"
	"encoding/json"

	"github.com/kweaver-ai/idrm-go-frame/core/telemetry/log"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/dto"
)

// getDataAuthInfoFromCache 从缓存中获取数据资源授权申请信息
func (u *useCase) getDataAuthInfoFromCache(ctx context.Context, dataID string) (*dto.DataViewAuthAuditDetail, error) {
	//1. 查询数据资源授权申请信息
	detailString, err := u.redisClient.Get(ctx, genDataAuthRedisKey(dataID))
	if err != nil {
		log.WithContext(ctx).Errorf("failed to get data resource auth apply info: %v", err)
		return nil, err
	}
	detail := &dto.DataViewAuthAuditDetail{}
	err = json.Unmarshal([]byte(detailString), detail)
	if err != nil {
		log.WithContext(ctx).Errorf("failed to unmarshal data resource auth apply info: %v", err)
		return nil, err
	}
	return detail, nil
}

// setDataAuthInfoToCache 保存数据资源授权申请信息到缓存
func (u *useCase) setDataAuthInfoToCache(ctx context.Context, detail *dto.DataViewAuthAuditDetail) error {
	if err := u.redisClient.SetWithExp(ctx, genDataAuthRedisKey(detail.Resources.ID), detail, RedisSaveExpiration); err != nil {
		log.WithContext(ctx).Errorf("failed to set data resource auth apply info to cache: %v", err)
		return err
	}
	return nil
}
