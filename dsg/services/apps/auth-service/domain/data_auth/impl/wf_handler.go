package impl

import (
	"context"
	"encoding/json"
	"time"

	"github.com/kweaver-ai/idrm-go-common/rest/authorization"
	wf_common "github.com/kweaver-ai/idrm-go-common/workflow/common"
	"github.com/kweaver-ai/idrm-go-frame/core/telemetry/log"
	"github.com/samber/lo"
	"go.uber.org/zap"
)

func (u *useCase) handleAuditProcess(ctx context.Context, auditType string, msg *wf_common.AuditProcessMsg) error {
	defer func() {
		if err := recover(); err != nil {
			log.WithContext(ctx).Error("[mq] AuditProcessMsgProc ", zap.Any("err", err))
		}
	}()
	//不需要处理这种消息
	if msg.CurrentActivity == nil {
		return nil
	}
	applyID := msg.ProcessInputModel.Fields.ApplyID
	dataID, err := parseAuditApplyID(applyID)
	if err != nil {
		log.WithContext(ctx).Warnf("failed to parse audit apply id: %v", err)
		return nil
	}
	log.Infof("handleAuditProcess applyID:%v", applyID)

	if !msg.ProcessInputModel.Fields.AuditIdea {
		auditState := wf_common.AUDIT_RESULT_REJECT
		auditAdvice := wf_common.GetAuditMsg(&msg.ProcessInputModel.WFCurComment, &msg.ProcessInputModel.Fields.AuditMsg)
		log.WithContext(ctx).Infof("update audit apply %v result auditState: %v, auditAdvice: %v", applyID, auditState, *auditAdvice)
		//更新状态
		if err := u.updateDataAuthInRedis(ctx, dataID, auditState, *auditAdvice); err != nil {
			log.WithContext(ctx).Errorf("failed to update audit apply %v result auditState: %v, auditAdvice: %v, err: %v", applyID, auditState, *auditAdvice, err)
			return err
		}
	}
	return nil
}

func (u *useCase) handleAuditResult(ctx context.Context, auditType string, msg *wf_common.AuditResultMsg) error {
	log.Warnf("handleAuditResult:%v", string(lo.T2(json.Marshal(msg)).A))
	dataID, err := parseAuditApplyID(msg.ApplyID)
	if err != nil {
		log.WithContext(ctx).Warnf("failed to parse audit apply id: %v", err)
		return nil
	}

	log.Infof("handleAuditResult applyID:%v", msg.ApplyID)
	auditState := wf_common.AUDIT_RESULT_REJECT
	switch msg.Result {
	case wf_common.AUDIT_RESULT_PASS:
		auditState = wf_common.AUDIT_RESULT_PASS
	case wf_common.AUDIT_RESULT_REJECT:
		auditState = wf_common.AUDIT_RESULT_REJECT
	case wf_common.AUDIT_RESULT_UNDONE:
		auditState = wf_common.AUDIT_RESULT_UNDONE
	default:
		log.WithContext(ctx).Warnf("unknown audit result type: %s, ignore it", msg.Result)
		return nil
	}
	//更新状态
	if err := u.updateDataAuthInRedis(ctx, dataID, auditState, ""); err != nil {
		log.WithContext(ctx).Warnf("AuditResultUpdate sandbox apply model %v result %v", msg.ApplyID, err)
		return err
	}
	//审核不通过，直接返回
	if msg.Result != wf_common.AUDIT_RESULT_PASS {
		return nil
	}
	//审核通过，调用接口，给用户授权
	err = u.grantDataResourceAuth(ctx, dataID)
	if err != nil {
		log.WithContext(ctx).Errorf("failed to grant data resource auth: %v", err)
		return err
	}
	return nil
}

func (u *useCase) grantDataResourceAuth(ctx context.Context, viewID string) error {
	//1. 查询数据资源授权申请信息
	detail, err := u.getDataAuthInfoFromCache(ctx, viewID)
	if err != nil {
		log.WithContext(ctx).Errorf("failed to get data resource auth apply info: %v", err)
		return err
	}
	//2. 给用户授权
	arg := &authorization.CreatePolicyReq{
		Accessor: authorization.Accessor{
			ID:   detail.Request.Applicant,
			Type: detail.Request.ApplicantType,
		},
		Resource: authorization.ResourceObject{
			ID:   detail.Resources.ID,
			Type: authorization.DATA_VIEW_RESOURCE_NAME,
		},
		Operation: authorization.AuthOperation{
			Allow: lo.Times(len(detail.Request.AuthOperations), func(index int) *authorization.OperationObject {
				return &authorization.OperationObject{
					ID: detail.Request.AuthOperations[index],
				}
			}),
		},
		ExpiresAt: wf_common.Now().Format(time.RFC3339),
	}
	resp, err := u.authDriven.CreatePolicy(ctx, []*authorization.CreatePolicyReq{arg})
	if err != nil {
		log.WithContext(ctx).Errorf("failed to grant data resource auth: %v", err)
		return err
	}
	if len(resp.Ids) <= 0 {
		log.WithContext(ctx).Errorf("failed to grant data resource auth: %v", err)
		return err
	}
	return nil
}

func (u *useCase) handleAuditDefDel(ctx context.Context, auditType string, msg *wf_common.AuditProcDefDelMsg) error {
	return nil
}
