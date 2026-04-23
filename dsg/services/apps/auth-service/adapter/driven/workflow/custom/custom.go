package custom

import (
	"github.com/kweaver-ai/idrm-go-common/workflow"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/adapter/driven/gorm"
	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/constant"
)

type WFConsumerRegister struct {
	wf              workflow.WorkflowInterface
	authRequestRepo gorm.ConsumeAuthRequestRepo
}

func NewWFConsumerRegister(
	wf workflow.WorkflowInterface,
	authRequestRepo gorm.ConsumeAuthRequestRepo,
) (*WFConsumerRegister, error) {
	r := &WFConsumerRegister{
		wf:              wf,
		authRequestRepo: authRequestRepo,
	}
	err := r.registerConsumeHandlers()
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (r *WFConsumerRegister) registerConsumeHandlers() error {
	// 数据权限申请结果消费
	r.wf.RegistConusmeHandlers(
		constant.DataPermissionRequest,
		r.authRequestRepo.ConsumerWorkflowAuditMsg,
		r.authRequestRepo.ConsumerWorkflowAuditResultRequest,
		r.authRequestRepo.ConsumerWorkflowAuditProcDeleteRequest,
	)
	return r.wf.Start()
}
