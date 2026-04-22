package impl

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kweaver-ai/idrm-go-common/middleware"
	"github.com/kweaver-ai/idrm-go-common/rest/authorization"
	"github.com/kweaver-ai/idrm-go-common/rest/configuration_center"
	"github.com/kweaver-ai/idrm-go-common/rest/data_model"
	wf_rest "github.com/kweaver-ai/idrm-go-common/rest/workflow"
	"github.com/kweaver-ai/idrm-go-common/workflow"
	wf_common "github.com/kweaver-ai/idrm-go-common/workflow/common"
	"github.com/kweaver-ai/idrm-go-frame/core/telemetry/log"
	"github.com/kweaver-ai/idrm-go-frame/core/telemetry/trace"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/dto"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/errorcode"
	domain "github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/domain/data_auth"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/infrastructure/repository/redis"
)

type useCase struct {
	wf          workflow.WorkflowInterface
	wfDriven    wf_rest.WorkflowDriven
	ccDriven    configuration_center.Driven
	redisClient *redis.Client
	dataModel   data_model.Driven
	authDriven  authorization.Driven
}

func NewDataAuth(
	wf workflow.WorkflowInterface,
	wfDriven wf_rest.WorkflowDriven,
	ccDriven configuration_center.Driven,
	redisClient *redis.Client,
	dataModel data_model.Driven,
	authDriven authorization.Driven,
) domain.UseCase {
	return &useCase{
		wf:          wf,
		wfDriven:    wfDriven,
		ccDriven:    ccDriven,
		redisClient: redisClient,
		dataModel:   dataModel,
		authDriven:  authDriven,
	}
}
func (u *useCase) RegisterWorkflowHandler() {
	u.wf.RegistConusmeHandlers(dto.AF_DATA_AUTH_REQUEST,
		workflow.HandlerFunc(dto.AF_DATA_AUTH_REQUEST, u.handleAuditProcess),
		workflow.HandlerFunc(dto.AF_DATA_AUTH_REQUEST, u.handleAuditResult),
		workflow.HandlerFunc(dto.AF_DATA_AUTH_REQUEST, u.handleAuditDefDel),
	)
}

func (u *useCase) DataResourceAuth(ctx context.Context, req *dto.DataResourceAuthReqArg) error {
	//1. 检查申请资源是否存在, 补充资源信息
	detail, err := u.getResourceAuthDetail(ctx, req)
	if err != nil {
		return err
	}
	//2. 发送审核消息
	isAuditProcessExist, err := u.SendAuditMsg(ctx, detail)
	if err != nil {
		return err
	}
	if !isAuditProcessExist {
		return errorcode.AuditProcessNotExistErr.Detail("audit process not exist")
	}
	return nil
}

func (u *useCase) getResourceAuthDetail(ctx context.Context, req *dto.DataResourceAuthReqArg) (*dto.DataResourceAuthAuditDetail, error) {
	//1. 检查申请资源是否存在, 补充资源信息
	resources, err := u.dataModel.GetDataModelByID(ctx, req.ResouceID...)
	if err != nil {
		return nil, err
	}
	//2. 检查授权操作是否存在, 不存在则默认查询和查看
	if len(req.AuthOperations) <= 0 {
		req.AuthOperations = []string{authorization.VIEW_OPERATION_DATA_QUERY, authorization.VIEW_OPERATION_VIEW_DETAIL}
	}
	detail := &dto.DataResourceAuthAuditDetail{
		Resources: make([]*dto.DataResourceAuthInfo, 0, len(resources)),
		Request:   req.DataResourceAuthRequest,
		AuditInfo: dto.DataResourceAuditInfo{
			ApplyID: uuid.New().String(),
		},
	}
	for _, resource := range resources {
		detail.Resources = append(detail.Resources, &dto.DataResourceAuthInfo{
			ID:             resource.Id,
			BusinessName:   resource.Name,
			TechnicalName:  resource.TechnicalName,
			DatasourceID:   resource.DataSourceId,
			DatasourceName: resource.DataSourceName,
		})
	}
	return detail, nil
}

// SendAuditMsg 发送审核消息
func (u *useCase) SendAuditMsg(ctx context.Context, detail *dto.DataResourceAuthAuditDetail) (isAuditProcessExist bool, err error) {
	ctx, _ = trace.StartInternalSpan(ctx)
	defer trace.EndSpan(ctx, err)

	//检查是否有绑定的审核流程
	process, err := u.ccDriven.GetProcessBindByAuditType(ctx,
		&configuration_center.GetProcessBindByAuditTypeReq{AuditType: dto.AF_DATA_AUTH_REQUEST})
	if err != nil {
		log.WithContext(ctx).Errorf("failed to check audit process info (type: %s), err: %v", dto.AF_DATA_AUTH_REQUEST, err)
		return false, nil
	}
	isAuditProcessExist = CE(process.ProcDefKey != "", true, false).(bool)
	if !isAuditProcessExist {
		return isAuditProcessExist, nil
	}
	uInfo, _ := dto.ObtainUserInfo(ctx)

	//循环发送审核消息
	for i := range detail.Resources {
		viewDetail := &dto.DataViewAuthAuditDetail{
			Resources: *detail.Resources[i],
			Request:   detail.Request,
			AuditInfo: detail.AuditInfo,
		}
		//发送审核消息
		if err = u.SendAuditMsgForDataView(ctx, uInfo, *process, viewDetail); err != nil {
			log.WithContext(ctx).Errorf("failed to send audit message for data view (type: %s), err: %v", dto.AF_DATA_AUTH_REQUEST, err)
			return false, err
		}
		//保存到redis
		if err = u.redisClient.SetWithExp(ctx, genDataAuthRedisKey(viewDetail.Resources.ID), viewDetail, RedisSaveExpiration); err != nil {
			log.WithContext(ctx).Errorf("failed to save audit message for data view (type: %s), err: %v", dto.AF_DATA_AUTH_REQUEST, err)
			return false, err
		}
	}
	return true, nil
}

func (u *useCase) SendAuditMsgForDataView(ctx context.Context,
	uInfo *middleware.User,
	process configuration_center.GetProcessBindByAuditTypeRes,
	detail *dto.DataViewAuthAuditDetail) (err error) {
	msg := &wf_common.AuditApplyMsg{
		Process: wf_common.AuditApplyProcessInfo{
			ApplyID:    genAuditApplyID(detail.Resources.ID),
			AuditType:  process.AuditType,
			UserID:     uInfo.ID,
			UserName:   uInfo.Name,
			ProcDefKey: process.ProcDefKey,
		},
		Data: map[string]any{
			"resources": detail.Resources,
			"request":   detail.Request,
		},
		Workflow: wf_common.AuditApplyWorkflowInfo{
			TopCsf: 5,
			AbstractInfo: wf_common.AuditApplyAbstractInfo{
				Icon: AUDIT_ICON_BASE64,
				Text: detail.GetAuditAbstractName() + "-数据资源授权审核",
			},
		},
	}
	log.Debugf("send audit message for data view (type: %s), msg: %v", dto.AF_DATA_AUTH_REQUEST, msg)
	detail.AuditInfo.AuditType = msg.Process.AuditType
	detail.AuditInfo.ApplyID = msg.Process.ApplyID
	detail.AuditInfo.ProcDefKey = process.ProcDefKey
	if err = u.wf.AuditApply(msg); err != nil {
		return errorcode.SendAuditApplyMsgErr.Detail(err.Error())
	}
	return nil
}

func (u *useCase) updateDataAuthInRedis(ctx context.Context, dataID, state, msg string) error {
	//1. 从缓存中获取数据资源授权申请信息
	detail, err := u.getDataAuthInfoFromCache(ctx, dataID)
	if err != nil {
		return err
	}
	//2. 更新数据资源授权申请信息
	detail.AuditInfo.AuditState = state
	detail.AuditInfo.AuditMsg = msg
	detail.AuditInfo.AuditTime = time.Now().Format(time.DateTime)
	//3. 保存到缓存
	return u.setDataAuthInfoToCache(ctx, detail)
}
